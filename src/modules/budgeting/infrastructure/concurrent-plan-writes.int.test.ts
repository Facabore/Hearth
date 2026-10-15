import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, type Result } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { categoryFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { createAddBudgetLine, type LineDeps, type LineInput } from "../application/add-budget-line";
import { createCreateBudgetPlan } from "../application/create-budget-plan";
import { createMapCategoriesToLine } from "../application/map-categories-to-line";
import type { BudgetPlanRepository, PlanSpending } from "../application/ports";
import { createUpdateBudgetLine, type LineChanges } from "../application/update-budget-line";
import { DrizzleBudgetPlanRepository } from "./drizzle-budget-plan-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const plans = new DrizzleBudgetPlanRepository(tm);
const spaces = new DrizzleSpaceRepository(tm);
const at = new Date("2026-10-14T12:00:00Z");
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
