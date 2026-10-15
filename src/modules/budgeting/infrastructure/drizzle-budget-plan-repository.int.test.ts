import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { domainError, err, FixedClock, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { testDatabase } from "../../../../tests/support/database";
import {
  categoryFixture,
  guestMemberFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";
import { codeOf, money, sequentialIds } from "../../../../tests/support/fakes";
import { InMemoryBudgetPlans } from "../../../../tests/support/in-memory-budgeting";
import type { BudgetPlanRepository, CapacityRepository } from "../application/ports";
import { createSetMemberCapacities } from "../application/set-member-capacities";
import type { BudgetLine, BudgetLineId } from "../domain/budget-line";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import { DrizzleBudgetPlanRepository } from "./drizzle-budget-plan-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleBudgetPlanRepository(tm);
const at = new Date("2026-10-14T12:00:00Z");
const later = new Date("2026-10-14T12:05:00Z");

afterAll(() => pool.end());

const household = async () => {
  const ana = await userFixture(pool, "Ana");
  const space = await sharedSpaceFixture(db, ana.id);
  return { space, fixture: { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id } };
};

const aPlan = (spaceId: string, label: string, start: string, end: string): BudgetPlan => ({
  id: randomUUID() as BudgetPlanId,
  spaceId,
  period: { label, start: start as LocalDate, end: end as LocalDate },
  status: "DRAFT",
  createdFrom: null,
  version: 1,
  createdBy: "u-ana",
  createdAt: at,
});

describe("DrizzleBudgetPlanRepository plans (HU-E6-01, D10)", () => {
  it("adds, finds, lists stored periods and locks versions like its in-memory twin", async () => {
    const { space } = await household();
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const october = aPlan(space.id, "2026-10", "2026-10-01", "2026-10-31");
    const sameStart = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const run = async (plans: BudgetPlanRepository) => ({
      added: [await plans.add(november), await plans.add(october), await plans.add(sameStart)],
      found: await plans.find(space.id, november.id),
      foreign: await plans.find(randomUUID(), november.id),
      malformed: [await plans.find(space.id, "not-a-uuid"), await plans.find("not-a-uuid", november.id)],
      stored: await plans.storedPeriods(space.id),
      hasPlans: [await plans.hasPlans(space.id), await plans.hasPlans(randomUUID())],
      malformedSpace: [await plans.storedPeriods("not-a-uuid"), await plans.hasPlans("not-a-uuid")],
      versions: [
        await plans.lockForWrite(november.id, null, later),
        await plans.lockForWrite(november.id, 2, later),
        await plans.lockForWrite(november.id, 2, later),
        await plans.lockForWrite(randomUUID() as BudgetPlanId, null, later),
      ],
      after: (await plans.find(space.id, november.id))?.version,
      contents: await plans.contents(november.id),
    });
    const expected = {
      added: [true, true, false],
      found: november,
      foreign: null,
      malformed: [null, null],
      stored: [october.period, november.period],
      hasPlans: [true, false],
      malformedSpace: [[], false],
      versions: [2, 3, null, null],
      after: 3,
      contents: { capacities: [], lines: [], mappings: [], allocations: [] },
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query("SELECT updated_at FROM budget_plans WHERE id = $1", [november.id]);
    expect(rows[0].updated_at).toEqual(later);
  });
});

/** What the tables hold, history included; written to PostgreSQL and to the twin alike. */
interface Rows {
  readonly capacities: readonly { planId: string; memberId: string; amount: bigint }[];
  readonly lines: readonly { line: BudgetLine; deletedAt: Date | null }[];
  readonly mappings: readonly {
    planId: string;
    lineId: string;
    categoryId: string;
    unmappedAt: Date | null;
  }[];
  readonly allocations: readonly {
    lineId: string;
    memberId: string;
    rule: "PERCENT" | "FIXED";
    value: bigint;
    supersededAt: Date | null;
  }[];
}

const writeRows = async (rows: Rows) => {
  for (const c of rows.capacities) {
    await pool.query(
      "INSERT INTO budget_member_capacities (plan_id, member_id, amount, updated_at) VALUES ($1, $2, $3, $4)",
      [c.planId, c.memberId, c.amount.toString(), at],
    );
  }
  for (const { line, deletedAt } of rows.lines) {
    await pool.query(
      `INSERT INTO budget_lines (id, plan_id, origin_line_id, name, planned_amount, funding, savings_account_ids,
         rollover_mode, is_catch_all, allocation_rule, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10, $11, $11, $12)`,
      [
        line.id,
        line.planId,
        line.originLineId,
        line.name,
        line.plannedAmount.toString(),
        line.funding,
        line.savingsAccountIds,
        line.rolloverMode,
        line.isCatchAll,
        line.allocationRule,
        line.createdAt,
        deletedAt,
      ],
    );
  }
  for (const m of rows.mappings) {
    await pool.query(
      "INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at, unmapped_at) VALUES ($1, $2, $3, $4, $5)",
      [m.planId, m.lineId, m.categoryId, at, m.unmappedAt],
    );
  }
  for (const a of rows.allocations) {
    await pool.query(
      "INSERT INTO budget_allocations (line_id, member_id, rule, value, set_at, superseded_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [a.lineId, a.memberId, a.rule, a.value.toString(), at, a.supersededAt],
    );
  }
};

const writeTwin = (twin: InMemoryBudgetPlans, rows: Rows) => {
  for (const c of rows.capacities) {
    twin.capacities.set(c.planId, [
      ...(twin.capacities.get(c.planId) ?? []),
      { memberId: c.memberId, amount: c.amount },
    ]);
  }
  twin.lines.push(...rows.lines);
  for (const m of rows.mappings) {
    twin.mappings.push({
      planId: m.planId,
      mapping: { lineId: m.lineId, categoryId: m.categoryId },
      mappedAt: at,
      unmappedAt: m.unmappedAt,
    });
  }
  for (const a of rows.allocations) {
    twin.allocations.push({
      allocation: { lineId: a.lineId, memberId: a.memberId, value: a.value },
      setAt: at,
      supersededAt: a.supersededAt,
    });
  }
};

describe("DrizzleBudgetPlanRepository contents (D7, D8)", () => {
  it("reads a plan's current parts in a fixed order, like its twin", async () => {
    const { space, fixture } = await household();
    const [november, december] = [
      aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30"),
      aPlan(space.id, "2026-12", "2026-12-01", "2026-12-31"),
    ];
    await repo.add(november);
    await repo.add(december);
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const [first, second] = [fixture.memberId, pedro].sort() as [string, string];
    const [groceries, rent, tea] = [
      await categoryFixture(db, fixture, "Groceries"),
      await categoryFixture(db, fixture, "Rent"),
      await categoryFixture(db, fixture, "Tea"),
    ];
    const [catA, catB] = [groceries, rent].sort() as [string, string];
    // Two lines created at the same instant: their ids decide the order (not their names, which sort the other way).
    const [leisureId, homeId] = [randomUUID(), randomUUID()].sort() as [string, string];
    const account = randomUUID();
    const id = (value: string) => value as BudgetLineId;
    const home = aLine("Home", 147_000_000n, {
      id: id(homeId),
      planId: november.id,
      rolloverMode: "ROLLOVER",
      isCatchAll: true,
      allocationRule: "FIXED",
    });
    const leisure = aLine("Leisure", 5_000_000n, {
      id: id(leisureId),
      planId: november.id,
      allocationRule: "PERCENT",
    });
    const savings = aLine("Savings", 60_000_000n, {
      id: id(randomUUID()),
      planId: november.id,
      funding: "SAVINGS",
      savingsAccountIds: [account],
      rolloverMode: "RESET",
      createdAt: later,
    });
    const gone = aLine("Gone", 100n, { id: id(randomUUID()), planId: november.id, allocationRule: "FIXED" });
    const decemberHome = aLine("Home", 147_000_000n, { id: id(randomUUID()), planId: december.id });
    // Rows are written in the order opposite to the one they are read in.
    const rows: Rows = {
      capacities: [
        { planId: november.id, memberId: second, amount: 90_000_000n },
        { planId: november.id, memberId: first, amount: 160_000_000n },
        { planId: december.id, memberId: first, amount: 70_000_000n },
      ],
      lines: [
        { line: home, deletedAt: null },
        { line: savings, deletedAt: null },
        { line: gone, deletedAt: at },
        { line: leisure, deletedAt: null },
        { line: decemberHome, deletedAt: null },
      ],
      mappings: [
        { planId: november.id, lineId: gone.id, categoryId: catA, unmappedAt: at },
        { planId: november.id, lineId: home.id, categoryId: catB, unmappedAt: null },
        { planId: november.id, lineId: home.id, categoryId: catA, unmappedAt: null },
        { planId: november.id, lineId: leisure.id, categoryId: tea, unmappedAt: null },
        { planId: december.id, lineId: decemberHome.id, categoryId: catA, unmappedAt: null },
      ],
      allocations: [
        { lineId: home.id, memberId: first, rule: "FIXED", value: 1n, supersededAt: at },
        { lineId: home.id, memberId: second, rule: "FIXED", value: 47_000_000n, supersededAt: null },
        { lineId: home.id, memberId: first, rule: "FIXED", value: 100_000_000n, supersededAt: null },
        { lineId: leisure.id, memberId: second, rule: "PERCENT", value: 4000n, supersededAt: null },
        { lineId: leisure.id, memberId: first, rule: "PERCENT", value: 6000n, supersededAt: null },
        { lineId: gone.id, memberId: first, rule: "FIXED", value: 5n, supersededAt: null },
        { lineId: decemberHome.id, memberId: first, rule: "FIXED", value: 147_000_000n, supersededAt: null },
      ],
    };
    const twin = new InMemoryBudgetPlans();
    writeTwin(twin, rows);
    await writeRows(rows);
    // Deleted lines, ended mappings and superseded values stay in the tables but out of every read; other plans'
    // parts stay out too.
    const expectedNovember = {
      capacities: [
        { memberId: first, amount: 160_000_000n },
        { memberId: second, amount: 90_000_000n },
      ],
      lines: [leisure, home, savings],
      mappings: [
        { lineId: leisure.id, categoryId: tea },
        { lineId: home.id, categoryId: catA },
        { lineId: home.id, categoryId: catB },
      ],
      allocations: [
        { lineId: leisure.id, memberId: first, value: 6000n },
        { lineId: leisure.id, memberId: second, value: 4000n },
        { lineId: home.id, memberId: first, value: 100_000_000n },
        { lineId: home.id, memberId: second, value: 47_000_000n },
      ],
    };
    const expectedDecember = {
      capacities: [{ memberId: first, amount: 70_000_000n }],
      lines: [decemberHome],
      mappings: [{ lineId: decemberHome.id, categoryId: catA }],
      allocations: [{ lineId: decemberHome.id, memberId: first, value: 147_000_000n }],
    };
    for (const plans of [twin, repo]) {
      expect(await plans.contents(november.id)).toEqual(expectedNovember);
      expect(await plans.contents(december.id)).toEqual(expectedDecember);
    }
  });
});

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Resolves once another backend waits for a lock that backend `pid` holds. */
const untilSomeoneWaitsFor = async (pid: number) => {
  for (let tries = 0; tries < 200; tries++) {
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [pid],
    );
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no backend ever waited for the lock of backend ${pid}`);
};

const versionOf = (result: Result<number | null>) => (result.ok ? result.value : result.error.code);

/**
 * A writer that has locked the plan and keeps its transaction open until `release()`, then commits or rolls back.
 * `done` settles with the transaction's result.
 */
const holdLock = async (planId: BudgetPlanId, expected: number | null, outcome: "commit" | "rollback") => {
  const holding = deferred<number>();
  const finish = deferred();
  const done = tm.run<number | null>(async () => {
    let version: number | null;
    try {
      version = await repo.lockForWrite(planId, expected, at);
      const { rows } = await tm.executor().execute(sql`SELECT pg_backend_pid() AS pid`);
      holding.resolve(Number(rows[0]?.pid));
    } catch (error) {
      holding.reject(error);
      throw error;
    }
    await finish.promise;
    return outcome === "commit" ? ok(version) : err(domainError("Rejected"));
  });
  try {
    return { pid: await holding.promise, release: finish.resolve, done };
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
};

/**
 * Two writers of one plan in separate transactions: the first locks the plan and keeps its transaction open until the
 * second is queued behind it, then commits or rolls back. Each writer's outcome: its version, or the error code.
 */
const race = async (
  planId: BudgetPlanId,
  expected: { first: number | null; second: number | null },
  outcome: "commit" | "rollback",
) => {
  const first = await holdLock(planId, expected.first, outcome);
  let second: Promise<Result<number | null>> | undefined;
  try {
    second = tm.run<number | null>(async () => ok(await repo.lockForWrite(planId, expected.second, at)));
    await untilSomeoneWaitsFor(first.pid);
    first.release();
    return [versionOf(await first.done), versionOf(await second)];
  } finally {
    // Whatever failed above, neither writer is left holding a connection or a lock.
    first.release();
    await Promise.allSettled([first.done, second]);
  }
};

describe("DrizzleBudgetPlanRepository lockForWrite (spec 7)", () => {
  const stored = async () => {
    const { space } = await household();
    const plan = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    await repo.add(plan);
    return { space, plan, versionNow: async () => (await repo.find(space.id, plan.id))?.version };
  };

  it("makes the second of two writers wait for the first and then refuses its stale If-Match", async () => {
    const { plan, versionNow } = await stored();
    expect(await race(plan.id, { first: 1, second: 1 }, "commit")).toEqual([2, null]);
    expect(await versionNow()).toBe(2);
  });

  it("queues writers without If-Match one after the other, none of their bumps lost", async () => {
    const { plan, versionNow } = await stored();
    expect(await race(plan.id, { first: null, second: null }, "commit")).toEqual([2, 3]);
    expect(await versionNow()).toBe(3);
  });

  it("gives the version back when the writing transaction rolls back", async () => {
    const { plan, versionNow } = await stored();
    expect(await race(plan.id, { first: 1, second: 1 }, "rollback")).toEqual(["Rejected", 2]);
    expect(await versionNow()).toBe(2);
  });

  it("lets exactly one of several simultaneous If-Match writes through, even outside a transaction", async () => {
    const { plan, versionNow } = await stored();
    const versions = await Promise.all(Array.from({ length: 8 }, () => repo.lockForWrite(plan.id, 1, at)));
    expect(versions.filter((version) => version !== null)).toEqual([2]);
    expect(await versionNow()).toBe(2);
  });

  it("lets a plan copied from the plan be stored while a writer holds the lock", async () => {
    const { space, plan } = await stored();
    const writer = await holdLock(plan.id, 1, "commit");
    try {
      // The foreign key of created_from_plan_id takes a KEY SHARE lock on the plan row, which FOR UPDATE would block.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '1s'");
        await client.query(
          `INSERT INTO budget_plans (id, space_id, label, start_date, end_date, status, created_from_plan_id,
             created_by, created_at, updated_at)
           VALUES ($1, $2, '2026-12', '2026-12-01', '2026-12-31', 'DRAFT', $3, 'u-ana', $4, $4)`,
          [randomUUID(), space.id, plan.id, at],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } finally {
      writer.release();
      await writer.done;
    }
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM budget_plans WHERE created_from_plan_id = $1",
      [plan.id],
    );
    expect(rows[0].n).toBe(1);
  });
});

describe("DrizzleBudgetPlanRepository capacities (HU-E6-02)", () => {
  it("inserts and replaces capacities like its in-memory twin, keeping the members not listed", async () => {
    const { space, fixture } = await household();
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const run = async (plans: BudgetPlanRepository & CapacityRepository) => {
      await plans.add(november);
      await plans.setCapacities(
        november.id,
        [
          { memberId: fixture.memberId, amount: 160_000_000n },
          { memberId: pedro, amount: 1n },
        ],
        at,
      );
      await plans.setCapacities(november.id, [{ memberId: pedro, amount: 30_000_000n }], at);
      await plans.setCapacities(november.id, [], at);
      return (await plans.contents(november.id)).capacities;
    };
    const expected = [
      { memberId: fixture.memberId, amount: 160_000_000n },
      { memberId: pedro, amount: 30_000_000n },
    ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
  });
});

describe("SetMemberCapacities over PostgreSQL (HU-E6-02, spec 7)", () => {
  it("rolls the version lock back with a refused write and leaves the capacities as they were", async () => {
    const { space, fixture } = await household();
    const plan = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    await repo.add(plan);
    const spaces = new DrizzleSpaceRepository(tm);
    const set = createSetMemberCapacities({
      access: createSpaceAccess(spaces),
      members: spaces,
      plans: repo,
      capacities: repo,
      spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
      ids: sequentialIds("budget"),
      clock: new FixedClock(later),
      tm,
    });
    const as = (capacities: { memberId: string; amount: Money }[], expectedVersion: number | null = null) =>
      set({ spaceId: space.id, userId: fixture.userId, planId: plan.id, expectedVersion, capacities });
    const stored = async () => ({
      version: (await repo.find(space.id, plan.id))?.version,
      capacities: (await repo.contents(plan.id)).capacities,
    });

    expect(codeOf(await as([{ memberId: fixture.memberId, amount: money(160_000_000n) }]))).toBe("ok");
    const written = { version: 2, capacities: [{ memberId: fixture.memberId, amount: 160_000_000n }] };
    expect(await stored()).toEqual(written);

    // The first two pass the lock and are refused afterwards, the third is refused by the lock itself.
    const refused = [
      await as([
        { memberId: fixture.memberId, amount: money(1n) },
        { memberId: randomUUID(), amount: money(1n) },
      ]),
      await as([{ memberId: fixture.memberId, amount: money(1n, "USD") }]),
      await as([{ memberId: fixture.memberId, amount: money(1n) }], 1),
    ];
    expect(refused.map(codeOf)).toEqual(["NotASpaceMember", "CurrencyMismatch", "PreconditionFailed"]);
    expect(await stored()).toEqual(written);
  });
});
