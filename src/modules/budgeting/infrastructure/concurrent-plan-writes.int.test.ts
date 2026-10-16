import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createRecordExpense } from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, type LocalDate, type Result } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import {
  accountFixture,
  categoryFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";
import { createAddBudgetLine, type LineDeps, type LineInput } from "../application/add-budget-line";
import { createClosedPeriodGuard, type ClosedPeriods } from "../application/closed-periods";
import { createCopyBudgetPlan } from "../application/copy-budget-plan";
import { createCreateBudgetPlan } from "../application/create-budget-plan";
import { createMapCategoriesToLine } from "../application/map-categories-to-line";
import { createCloseBudgetPlan } from "../application/plan-lifecycle";
import type { BudgetPlanRepository, PlanSpending } from "../application/ports";
import { createUpdateBudgetLine, type LineChanges } from "../application/update-budget-line";
import { DrizzleBudgetPlanRepository } from "./drizzle-budget-plan-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const plans = new DrizzleBudgetPlanRepository(tm);
const spaces = new DrizzleSpaceRepository(tm);
const at = new Date("2026-10-14T12:00:00Z");
/** What a close reads "today" from: 2026-12-01 at noon in Bogota, the day after the 2026-11 plans' period ended. */
const afterNovember = { clock: new FixedClock(new Date("2026-12-01T17:00:00Z")), timeZone: "America/Bogota" };
const nothingSpent: PlanSpending = {
  expensesByCategory: async () => [],
  transfersIntoAccounts: async () => [],
};

afterAll(() => pool.end());

/**
 * Polls `condition` every 20 ms and throws "gave up waiting for <what>" after 500 polls (about 10 s plus the time
 * the checks take): a bound for a hung test, never a delay a passing test waits for.
 */
const until = async (what: string, condition: () => Promise<boolean> | boolean) => {
  for (let tries = 0; tries < 500; tries++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`gave up waiting for ${what}`);
};

/** Whether some backend is waiting for a lock that backend `pid` holds. */
const someoneWaitsFor = async (pid: number) => {
  const { rows } = await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [
    pid,
  ]);
  return rows.length > 0;
};

/**
 * The rendezvous of two writers in separate transactions: the first to meet stays inside its transaction until the
 * second has met too, or until the second is seen queued behind a lock the first holds (the plan's version lock).
 * Either way both writers are inside their transactions and neither has committed when the first goes on. Without
 * the lock the second meets and both act on the same stale reading; with it the second is still queued at the lock
 * and reads only after the first commits, so it sees what the first wrote. Both ends are observed events, never a
 * delay: the passing test waits for nothing else.
 */
const rendezvous = () => {
  let arrivals = 0;
  return async () => {
    arrivals += 1;
    if (arrivals > 1) return;
    const { rows } = await tm.executor().execute(sql`SELECT pg_backend_pid() AS pid`);
    const pid = Number(rows[0]?.pid);
    await until(
      `the second writer to meet or to queue behind backend ${pid}`,
      async () => arrivals > 1 || (await someoneWaitsFor(pid)),
    );
  };
};

/**
 * A transaction that stops in `hold()` until another backend queues behind a lock it holds, or until `release()`
 * says the other side finished without queueing; `held` resolves once it stopped there. Both ends are observed
 * events, never a delay.
 */
const holder = () => {
  let released = false;
  let stopped: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    stopped = resolve;
  });
  const hold = async () => {
    const { rows } = await tm.executor().execute(sql`SELECT pg_backend_pid() AS pid`);
    const pid = Number(rows[0]?.pid);
    stopped();
    await until(
      `another backend to queue behind backend ${pid}, or the other side to finish`,
      async () => released || (await someoneWaitsFor(pid)),
    );
  };
  const release = () => {
    released = true;
  };
  return { held, hold, release };
};

/** What a writer that failed reports: the database's own message when there is one, so it reads in the diff. */
const failure = (reason: unknown) => {
  const cause = reason instanceof Error && reason.cause instanceof Error ? reason.cause : reason;
  return `rejected: ${cause instanceof Error ? cause.message : String(cause)}`;
};

/**
 * Lets every writer run to the end, so one that fails never leaves the other running past the test with its
 * connection: the sorted outcomes are each writer's error code, "ok", or "rejected: <message>" for a raw error.
 */
const outcomesOf = async (...writers: Promise<Result<unknown>>[]) =>
  (await Promise.allSettled(writers))
    .map((writer) => (writer.status === "fulfilled" ? codeOf(writer.value) : failure(writer.reason)))
    .sort();

/** The real plan repository, with the reads named in `overrides` replaced. */
const repositoryWith = (overrides: Partial<BudgetPlanRepository>): BudgetPlanRepository => ({
  add: (plan) => plans.add(plan),
  find: (spaceId, planId) => plans.find(spaceId, planId),
  storedPeriods: (spaceId) => plans.storedPeriods(spaceId),
  hasPlans: (spaceId) => plans.hasPlans(spaceId),
  covering: (spaceId, date, options) => plans.covering(spaceId, date, options),
  lockForWrite: (planId, expectedVersion, lockedAt) => plans.lockForWrite(planId, expectedVersion, lockedAt),
  contents: (planId) => plans.contents(planId),
  ...overrides,
});

/** Writers of a plan that meet after reading its parts, before writing: each decides on what it read. */
const meetingAfterParts = (): BudgetPlanRepository => {
  const meet = rendezvous();
  return repositoryWith({
    contents: async (planId) => {
      const parts = await plans.contents(planId);
      await meet();
      return parts;
    },
  });
};

/** Creators of a plan that meet after reading the stored periods, before inserting. */
const meetingAfterPeriods = (): BudgetPlanRepository => {
  const meet = rendezvous();
  return repositoryWith({
    storedPeriods: async (spaceId) => {
      const stored = await plans.storedPeriods(spaceId);
      await meet();
      return stored;
    },
  });
};

/** Household with Ana as OWNER and the deps of the real use cases over PostgreSQL. */
const household = async () => {
  const ana = await userFixture(pool, "Ana");
  const space = await sharedSpaceFixture(db, ana.id);
  const deps = {
    access: createSpaceAccess(spaces),
    members: spaces,
    plans,
    spending: nothingSpent,
    // Any account is one of Ana's COP savings accounts: only the plan's lines decide whether it is still free.
    savingsAccounts: {
      find: async (id: string) => ({
        id,
        ownerUserId: ana.id,
        isSavings: true,
        archived: false,
        currency: "COP",
      }),
    },
    ids: new UuidV7IdGenerator(),
    clock: new FixedClock(at),
    tm,
  };
  return { ana, space, deps };
};

/** A plan for November 2026 in which Ana has `capacity`, and the line use cases over a given plan repository. */
const planWith = async (capacity: bigint) => {
  const { ana, space, deps } = await household();
  const { plan } = unwrap(
    await createCreateBudgetPlan(deps)({ spaceId: space.id, userId: ana.id, period: "2026-11" }),
  );
  await plans.setCapacities(plan.id, [{ memberId: space.members[0]!.id, amount: capacity }], at);
  const lineDeps = (repository: BudgetPlanRepository): LineDeps => ({
    ...deps,
    plans: repository,
    lines: plans,
  });
  const write = { spaceId: space.id, userId: ana.id, planId: plan.id, expectedVersion: null };
  const addLines = (repository: BudgetPlanRepository) => {
    const add = createAddBudgetLine(lineDeps(repository));
    return (line: LineInput) => add({ ...write, line });
  };
  const updateLines = (repository: BudgetPlanRepository) => {
    const update = createUpdateBudgetLine(lineDeps(repository));
    return (lineId: string, changes: LineChanges) => update({ ...write, lineId, changes });
  };
  const currentLines = async () => (await plans.contents(plan.id)).lines;
  const currentMappings = async () => (await plans.contents(plan.id)).mappings;
  const mapCategories = async (repository: BudgetPlanRepository) => {
    const groceries = await categoryFixture(db, {
      userId: ana.id,
      spaceId: space.id,
      memberId: space.members[0]!.id,
    });
    const map = createMapCategoriesToLine({
      ...lineDeps(repository),
      mappings: plans,
      categories: {
        list: async () => [{ id: groceries, archived: false }],
      },
    });
    return {
      groceries,
      mapTo: (lineId: string, categoryIds: string[]) => map({ ...write, lineId, categoryIds }),
    };
  };
  return { addLines, updateLines, currentLines, currentMappings, mapCategories };
};

describe("concurrent writes to one plan (Review Focus 1)", () => {
  it("adds one of two lines that each fit the capacity but not together", async () => {
    const { addLines, currentLines } = await planWith(100_000_000n);
    const add = addLines(meetingAfterParts());
    const outcomes = await outcomesOf(
      add({ name: "Home", plannedAmount: money(60_000_000n) }),
      add({ name: "Rent", plannedAmount: money(60_000_000n) }),
    );
    expect(outcomes).toEqual(["PlanExceedsCapacity", "ok"]);
    expect(await currentLines()).toHaveLength(1);
  });

  it("marks one of two lines as the catch-all line", async () => {
    const { addLines, updateLines, currentLines } = await planWith(100_000_000n);
    const seed = addLines(plans);
    unwrap(await seed({ name: "Home", plannedAmount: money(30_000_000n) }));
    unwrap(await seed({ name: "Rent", plannedAmount: money(30_000_000n) }));
    const [home, rent] = await currentLines();
    const update = updateLines(meetingAfterParts());
    const outcomes = await outcomesOf(
      update(home!.id, { isCatchAll: true }),
      update(rent!.id, { isCatchAll: true }),
    );
    expect(outcomes).toEqual(["CatchAllLineAlreadySet", "ok"]);
    expect((await currentLines()).filter((line) => line.isCatchAll)).toHaveLength(1);
  });

  it("gives a savings account to one of two lines that name it", async () => {
    const { addLines, currentLines } = await planWith(100_000_000n);
    const add = addLines(meetingAfterParts());
    const account = randomUUID();
    const saving = (name: string) =>
      add({
        name,
        plannedAmount: money(10_000_000n),
        funding: "SAVINGS",
        savingsAccountIds: [account],
      });
    const outcomes = await outcomesOf(saving("Trip"), saving("Holiday"));
    expect(outcomes).toEqual(["SavingsAccountAlreadyUsed", "ok"]);
    expect(await currentLines()).toHaveLength(1);
  });

  it("maps a category to one of two lines that both ask for it", async () => {
    const { addLines, currentLines, currentMappings, mapCategories } = await planWith(100_000_000n);
    const seed = addLines(plans);
    unwrap(await seed({ name: "Home", plannedAmount: money(30_000_000n) }));
    unwrap(await seed({ name: "Rent", plannedAmount: money(30_000_000n) }));
    const [home, rent] = await currentLines();
    const { groceries, mapTo } = await mapCategories(meetingAfterParts());
    const outcomes = await outcomesOf(mapTo(home!.id, [groceries]), mapTo(rent!.id, [groceries]));
    expect(outcomes).toEqual(["CategoryAlreadyMapped", "ok"]);
    expect(await currentMappings()).toHaveLength(1);
  });

  it("creates one of two simultaneous plans for the same period", async () => {
    const { ana, space, deps } = await household();
    const create = createCreateBudgetPlan({ ...deps, plans: meetingAfterPeriods() });
    const input = { spaceId: space.id, userId: ana.id, period: "2026-11" };
    const outcomes = await outcomesOf(create(input), create(input));
    expect(outcomes).toEqual(["PlanAlreadyExists", "ok"]);
    expect(await plans.storedPeriods(space.id)).toHaveLength(1);
  });
});

describe("closing and copying while others write (HU-E6-06, HU-E6-07, Review Focus 1)", () => {
  type Household = Awaited<ReturnType<typeof household>>;

  /**
   * An ACTIVE 2026-11 plan in which Ana has 1,000,000 COP, and its close, which stops in `h.hold` once it set CLOSED.
   * `closeDeps` are its deps once the period is over (a plan closes only after its period has ended).
   */
  const activePlan = async () => {
    const { ana, space, deps } = await household();
    const closeDeps = { ...deps, ...afterNovember };
    const { plan } = unwrap(
      await createCreateBudgetPlan(deps)({ spaceId: space.id, userId: ana.id, period: "2026-11" }),
    );
    await plans.setCapacities(plan.id, [{ memberId: space.members[0]!.id, amount: 100_000_000n }], at);
    await plans.setStatus(plan.id, "ACTIVE", at);
    const write = { spaceId: space.id, userId: ana.id, planId: plan.id, expectedVersion: null };
    const closeHolding = (h: ReturnType<typeof holder>) =>
      createCloseBudgetPlan({
        ...closeDeps,
        statuses: {
          setStatus: async (planId, status, changedAt) => {
            await plans.setStatus(planId, status, changedAt);
            await h.hold();
          },
        },
      })(write);
    return { ana, space, deps, closeDeps, plan, write, closeHolding };
  };

  /**
   * A line added to the active plan while a close of it holds its lock; `staleIfMatch` sends the version the plan had
   * before that close as the adder's If-Match.
   */
  const lineAddedWhileClosing = async (staleIfMatch: boolean) => {
    const { deps, plan, write, closeHolding } = await activePlan();
    const h = holder();
    const closing = closeHolding(h);
    await h.held;
    const adding = createAddBudgetLine({ ...deps, lines: plans })({
      ...write,
      expectedVersion: staleIfMatch ? plan.version : null,
      line: { name: "Home", plannedAmount: money(10_000_000n) },
    }).finally(h.release);
    return { outcomes: await outcomesOf(closing, adding), lines: (await plans.contents(plan.id)).lines };
  };

  /**
   * The ledger's RecordExpense for an expense dated 2026-11-15, as `src/composition/container.ts` builds it: the real
   * transaction repository and the closed-period guard `closedPeriods` over the same `tm`, so the guard runs inside
   * the expense's own transaction. The stand-ins are the account and category readers, `accountBalances` (always 0)
   * and `defaultSplits` (no allocation, so EQUAL); the members, the ledger queries, the audit log and `storedPeriods`
   * are the real adapters.
   */
  const expenseInNovember = async ({ ana, space, deps }: Household, closedPeriods: ClosedPeriods) => {
    const member = { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id };
    const bank = await accountFixture(db, member, "Bancolombia");
    const groceries = await categoryFixture(db, member);
    const record = createRecordExpense({
      access: deps.access,
      members: spaces,
      transactions: new DrizzleTransactionRepository(tm),
      query: new DrizzleLedgerQueries(tm),
      audit: new DrizzleAuditLog(tm),
      accounts: {
        find: async (id) => ({
          id,
          spaceId: space.id,
          ownerUserId: ana.id,
          isSharedFund: false,
          archived: false,
        }),
      },
      accountBalances: { balanceOf: async () => 0n },
      categories: { find: async (_, id) => ({ id, archived: false }) },
      closedPeriods,
      defaultSplits: { allocationWeights: async () => null },
      storedPeriods: (spaceId) => plans.storedPeriods(spaceId),
      ids: deps.ids,
      clock: deps.clock,
      timeZone: "America/Bogota",
      tm,
    });
    return () =>
      record({
        spaceId: space.id,
        userId: ana.id,
        date: "2026-11-15" as LocalDate,
        categoryId: groceries,
        amount: money(8_500_000n),
        accountId: bank,
      });
  };

  const recordedExpenses = async (spaceId: string) =>
    (await pool.query("SELECT 1 FROM transactions WHERE space_id = $1", [spaceId])).rowCount;

  /** CopyBudgetPlan over `repository` for the plans, and the real repository for the parts. */
  const copyOver = ({ deps }: Household, repository: BudgetPlanRepository = plans) =>
    createCopyBudgetPlan({
      ...deps,
      plans: repository,
      capacities: plans,
      lines: plans,
      mappings: plans,
      allocations: plans,
      categories: { list: async () => [] },
    });

  it("refuses a line added while the plan was being closed: its status is read after the lock (N4)", async () => {
    expect(await lineAddedWhileClosing(false)).toEqual({ outcomes: ["PeriodClosed", "ok"], lines: [] });
  });

  it("answers an If-Match from before the close with PreconditionFailed: the version is compared before the status", async () => {
    expect(await lineAddedWhileClosing(true)).toEqual({ outcomes: ["PreconditionFailed", "ok"], lines: [] });
  });

  it("makes a ledger write wait for a close in progress, which it then sees (P14)", async () => {
    const active = await activePlan();
    const record = await expenseInNovember(active, createClosedPeriodGuard(plans));
    const h = holder();
    const closing = active.closeHolding(h);
    await h.held;
    const recording = record().finally(h.release);
    expect(await outcomesOf(closing, recording)).toEqual(["PeriodClosed", "ok"]);
    expect(await recordedExpenses(active.space.id)).toBe(0);
  });

  it("makes a close wait for a ledger write that already checked the period (P14)", async () => {
    const active = await activePlan();
    const guard = createClosedPeriodGuard(plans);
    const h = holder();
    const record = await expenseInNovember(active, {
      isClosed: async (spaceId, date) => {
        const closed = await guard.isClosed(spaceId, date);
        await h.hold();
        return closed;
      },
    });
    const order: string[] = [];
    const recording = record().then((result) => {
      order.push("ledger write");
      return result;
    });
    await h.held;
    const closing = createCloseBudgetPlan({ ...active.closeDeps, statuses: plans })(active.write)
      .then((result) => {
        order.push("close");
        return result;
      })
      .finally(h.release);
    expect(await outcomesOf(recording, closing)).toEqual(["ok", "ok"]);
    expect(order).toEqual(["ledger write", "close"]);
    expect(await recordedExpenses(active.space.id)).toBe(1);
  });

  it("copies the version of its source that a write in progress commits (P14)", async () => {
    const { ana, space, deps } = await household();
    const { plan: november } = unwrap(
      await createCreateBudgetPlan(deps)({ spaceId: space.id, userId: ana.id, period: "2026-11" }),
    );
    await plans.setCapacities(november.id, [{ memberId: space.members[0]!.id, amount: 100_000_000n }], at);
    const write = { spaceId: space.id, userId: ana.id, planId: november.id, expectedVersion: null };
    unwrap(
      await createAddBudgetLine({ ...deps, lines: plans })({
        ...write,
        line: { name: "Home", plannedAmount: money(30_000_000n) },
      }),
    );
    const [home] = (await plans.contents(november.id)).lines;
    const h = holder();
    const updating = createUpdateBudgetLine({
      ...deps,
      lines: {
        addLine: (line, addedAt) => plans.addLine(line, addedAt),
        deleteLine: (planId, lineId, deletedAt) => plans.deleteLine(planId, lineId, deletedAt),
        saveLine: async (line, savedAt) => {
          await plans.saveLine(line, savedAt);
          await h.hold();
        },
      },
    })({ ...write, lineId: home!.id, changes: { plannedAmount: money(40_000_000n) } });
    await h.held;
    const copying = copyOver({ ana, space, deps })({
      spaceId: space.id,
      userId: ana.id,
      period: "2026-12",
    }).finally(h.release);
    expect(await outcomesOf(updating, copying)).toEqual(["ok", "ok"]);
    const december = unwrap(await copying).view;
    expect(
      december.figures.lines.map((l) => [l.line.name, l.line.plannedAmount, l.line.originLineId]),
    ).toEqual([["Home", 40_000_000n, home!.id]]);
  });

  it("creates one of two simultaneous copies of the same period and answers the other PlanAlreadyExists", async () => {
    const active = await activePlan();
    const input = { spaceId: active.space.id, userId: active.ana.id, period: "2026-12" };
    const h = holder();
    // The first copy stops once its plan is inserted and uncommitted; the second then queues behind that row.
    const first = copyOver(
      active,
      repositoryWith({
        add: async (plan) => {
          const added = await plans.add(plan);
          await h.hold();
          return added;
        },
      }),
    )(input);
    await h.held;
    const second = copyOver(active)(input).finally(h.release);
    expect(await outcomesOf(first, second)).toEqual(["PlanAlreadyExists", "ok"]);
    expect(await plans.storedPeriods(active.space.id)).toHaveLength(2);
  });
});
