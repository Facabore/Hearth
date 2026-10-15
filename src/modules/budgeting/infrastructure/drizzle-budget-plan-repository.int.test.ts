import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createSpaceAccess, type SpaceMemberId } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { domainError, err, FixedClock, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { testDatabase } from "../../../../tests/support/database";
import {
  categoryFixture,
  guestMemberFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";
import { codeOf, money, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { InMemoryBudgetPlans } from "../../../../tests/support/in-memory-budgeting";
import type {
  AllocationRepository,
  BudgetLineRepository,
  BudgetPlanRepository,
  CapacityRepository,
  CategoryMappingRepository,
} from "../application/ports";
import { createAddBudgetLine, type LineInput } from "../application/add-budget-line";
import { createAllocateBudgetLine } from "../application/allocate-budget-line";
import { createGetBudgetPlan } from "../application/get-budget-plan";
import { createMapCategoriesToLine } from "../application/map-categories-to-line";
import type { BudgetPlanView } from "../application/plan-view";
import { createRemoveBudgetLine } from "../application/remove-budget-line";
import { createSetMemberCapacities } from "../application/set-member-capacities";
import { createUpdateBudgetLine, type LineChanges } from "../application/update-budget-line";
import type { AllocationInput } from "../domain/allocation";
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
      savingsAccounts: { find: async () => null },
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

describe("DrizzleBudgetPlanRepository lines (HU-E6-03, D8)", () => {
  it("adds, saves and removes lines like its in-memory twin, keeping the removed row", async () => {
    const { space } = await household();
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const home = aLine("Home", 147_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      createdAt: at,
    });
    const savings = aLine("Savings", 60_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      funding: "SAVINGS",
      savingsAccountIds: [randomUUID()],
      createdAt: new Date("2026-10-14T12:01:00Z"),
    });
    const house = {
      ...home,
      name: "House",
      plannedAmount: 150_000_000n,
      rolloverMode: "ROLLOVER" as const,
      isCatchAll: true,
    };
    const run = async (plans: BudgetPlanRepository & BudgetLineRepository) => {
      await plans.add(november);
      await plans.addLine(home, at);
      await plans.addLine(savings, at);
      await plans.saveLine({ ...house, allocationRule: "NONE" }, at);
      await plans.deleteLine(november.id, savings.id, at);
      await plans.deleteLine(november.id, savings.id, new Date("2026-10-15T00:00:00Z"));
      // A removed line is out of every write: saving it again changes nothing.
      await plans.saveLine({ ...savings, name: "Revived" }, later);
      return (await plans.contents(november.id)).lines;
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual([house]);
    expect(await run(repo)).toEqual([house]);
    const { rows } = await pool.query(
      "SELECT name, allocation_rule, deleted_at FROM budget_lines WHERE plan_id = $1 ORDER BY name",
      [november.id],
    );
    expect(rows).toEqual([
      { name: "House", allocation_rule: "PROPORTIONAL", deleted_at: null },
      { name: "Savings", allocation_rule: "PROPORTIONAL", deleted_at: at },
    ]);
  });

  it("saves a line only through its own plan and never rewrites where or when it was made, like its twin", async () => {
    const { space } = await household();
    const [november, december] = [
      aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30"),
      aPlan(space.id, "2026-12", "2026-12-01", "2026-12-31"),
    ];
    const home = aLine("Home", 147_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      createdAt: at,
    });
    const decemberHome = aLine("Home", 100n, {
      id: randomUUID() as BudgetLineId,
      planId: december.id,
      createdAt: at,
    });
    const run = async (plans: BudgetPlanRepository & BudgetLineRepository) => {
      await plans.add(november);
      await plans.add(december);
      await plans.addLine(home, at);
      await plans.addLine(decemberHome, at);
      // Asked through the other plan, the line is not found: nothing is saved, in either plan.
      await plans.saveLine({ ...home, planId: december.id, name: "Elsewhere" }, later);
      await plans.saveLine({ ...decemberHome, planId: november.id, name: "Elsewhere" }, later);
      // Asked through its own plan, only what a request may change is saved.
      await plans.saveLine(
        { ...home, name: "House", originLineId: decemberHome.id, createdAt: later },
        later,
      );
      return {
        november: (await plans.contents(november.id)).lines,
        december: (await plans.contents(december.id)).lines,
      };
    };
    const expected = { november: [{ ...home, name: "House" }], december: [decemberHome] };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query(
      "SELECT name, plan_id, origin_line_id, created_at, updated_at FROM budget_lines WHERE id = ANY($1) ORDER BY name",
      [[home.id, decemberHome.id]],
    );
    expect(rows).toEqual([
      { name: "Home", plan_id: december.id, origin_line_id: null, created_at: at, updated_at: at },
      { name: "House", plan_id: november.id, origin_line_id: null, created_at: at, updated_at: later },
    ]);
  });
});

describe("DrizzleBudgetPlanRepository deleteLine mappings (HU-E6-03, D8)", () => {
  it("ends only the mappings of the removed line of that plan, like its twin, and keeps their rows", async () => {
    const { space, fixture } = await household();
    const [november, december] = [
      aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30"),
      aPlan(space.id, "2026-12", "2026-12-01", "2026-12-31"),
    ];
    const [groceries, rent, tea] = [
      await categoryFixture(db, fixture, "Groceries"),
      await categoryFixture(db, fixture, "Rent"),
      await categoryFixture(db, fixture, "Tea"),
    ];
    const id = () => randomUUID() as BudgetLineId;
    const home = aLine("Home", 100n, { id: id(), planId: november.id });
    const leisure = aLine("Leisure", 100n, { id: id(), planId: november.id });
    const decemberHome = aLine("Home", 100n, { id: id(), planId: december.id });
    const mapped = (line: BudgetLine, categoryId: string, unmappedAt: Date | null = null) => ({
      planId: line.planId,
      lineId: line.id,
      categoryId,
      unmappedAt,
    });
    const rows: Rows = {
      capacities: [],
      lines: [home, leisure, decemberHome].map((line) => ({ line, deletedAt: null })),
      mappings: [
        mapped(home, groceries),
        mapped(home, rent),
        mapped(leisure, tea),
        mapped(decemberHome, groceries),
      ],
      allocations: [],
    };
    const twin = new InMemoryBudgetPlans();
    writeTwin(twin, rows);
    await repo.add(november);
    await repo.add(december);
    await writeRows(rows);
    const readOf = async (plans: BudgetPlanRepository, planId: BudgetPlanId) =>
      (await plans.contents(planId)).mappings;
    for (const plans of [twin, repo]) {
      // A line asked for through another plan stays, with its mappings.
      await plans.deleteLine(december.id, home.id, at);
      expect(await readOf(plans, november.id)).toHaveLength(3);
      await plans.deleteLine(november.id, home.id, at);
      expect(await readOf(plans, november.id)).toEqual([{ lineId: leisure.id, categoryId: tea }]);
      expect(await readOf(plans, december.id)).toEqual([{ lineId: decemberHome.id, categoryId: groceries }]);
    }
    const { rows: stored } = await pool.query(
      "SELECT line_id, category_id, unmapped_at FROM budget_line_categories WHERE plan_id = $1 ORDER BY category_id",
      [november.id],
    );
    expect(stored.map((r) => [r.line_id === home.id, r.unmapped_at])).toEqual(
      [groceries, rent, tea].sort().map((categoryId) => [categoryId !== tea, categoryId === tea ? null : at]),
    );
  });
});

describe("AddBudgetLine over PostgreSQL (HU-E6-03, spec 7)", () => {
  it("stores accepted lines and rolls the version lock back with a refused one, leaving no row", async () => {
    const { space, fixture } = await household();
    const plan = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    await repo.add(plan);
    const spaces = new DrizzleSpaceRepository(tm);
    const [account, other] = [randomUUID(), randomUUID()];
    const deps = {
      access: createSpaceAccess(spaces),
      members: spaces,
      plans: repo,
      capacities: repo,
      lines: repo,
      // Ana owns `account` and `other` belongs to nobody the space knows.
      savingsAccounts: {
        find: async (id: string) =>
          id === account
            ? { id, ownerUserId: fixture.userId, isSavings: true, archived: false, currency: "COP" }
            : null,
      },
      spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
      ids: new UuidV7IdGenerator(),
      clock: new FixedClock(later),
      tm,
    };
    const add = createAddBudgetLine(deps);
    const addLine = (line: LineInput, expectedVersion: number | null = null) =>
      add({ spaceId: space.id, userId: fixture.userId, planId: plan.id, expectedVersion, line });
    const stored = async () => ({
      version: (await repo.find(space.id, plan.id))?.version,
      lines: (await repo.contents(plan.id)).lines.map((l) => l.name),
      rows: (await pool.query("SELECT count(*)::int AS n FROM budget_lines WHERE plan_id = $1", [plan.id]))
        .rows[0].n,
    });

    const capacities = [{ memberId: fixture.memberId, amount: money(200_000_000n) }];
    const set = createSetMemberCapacities(deps);
    unwrap(
      await set({
        spaceId: space.id,
        userId: fixture.userId,
        planId: plan.id,
        expectedVersion: null,
        capacities,
      }),
    );
    expect(codeOf(await addLine({ name: "Home", plannedAmount: money(100_000_000n) }))).toBe("ok");
    const savings: LineInput = {
      name: "Savings",
      plannedAmount: money(60_000_000n),
      funding: "SAVINGS",
      savingsAccountIds: [account],
    };
    expect(codeOf(await addLine(savings))).toBe("ok");
    const written = { version: 4, lines: ["Home", "Savings"], rows: 2 };
    expect(await stored()).toEqual(written);
    const { rows } = await pool.query(
      `SELECT name, planned_amount::text, funding, savings_account_ids, rollover_mode, is_catch_all, allocation_rule
         FROM budget_lines WHERE plan_id = $1 ORDER BY name`,
      [plan.id],
    );
    expect(rows).toEqual([
      {
        name: "Home",
        planned_amount: "100000000",
        funding: "DIRECT",
        savings_account_ids: [],
        rollover_mode: "RESET",
        is_catch_all: false,
        allocation_rule: "PROPORTIONAL",
      },
      {
        name: "Savings",
        planned_amount: "60000000",
        funding: "SAVINGS",
        savings_account_ids: [account],
        rollover_mode: "RESET",
        is_catch_all: false,
        allocation_rule: "PROPORTIONAL",
      },
    ]);

    // All but the last pass the lock and are refused afterwards; the last is refused by the lock itself.
    const refused = [
      await addLine({ name: "Travel", plannedAmount: money(40_000_001n) }),
      await addLine({ name: "home", plannedAmount: money(1n) }),
      await addLine({ ...savings, name: "More savings", plannedAmount: money(1n) }),
      await addLine({ ...savings, name: "Foreign", plannedAmount: money(1n), savingsAccountIds: [other] }),
      await addLine({ name: "Gifts", plannedAmount: money(1n, "USD") }),
      await addLine({ name: "Gifts", plannedAmount: money(1n) }, 3),
    ];
    expect(refused.map(codeOf)).toEqual([
      "PlanExceedsCapacity",
      "BudgetLineNameTaken",
      "SavingsAccountAlreadyUsed",
      "AccountNotFound",
      "CurrencyMismatch",
      "PreconditionFailed",
    ]);
    expect(await stored()).toEqual(written);
  });
});

describe("UpdateBudgetLine and RemoveBudgetLine over PostgreSQL (HU-E6-03, HU-E6-04, spec 7)", () => {
  it("stores accepted edits and removals, and rolls the version lock back with a refused one, leaving every row as it was", async () => {
    const { space, fixture } = await household();
    const plan = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    await repo.add(plan);
    const spaces = new DrizzleSpaceRepository(tm);
    const [account, other] = [randomUUID(), randomUUID()];
    const deps = {
      access: createSpaceAccess(spaces),
      members: spaces,
      plans: repo,
      capacities: repo,
      lines: repo,
      // Ana owns `account` and `other` belongs to nobody the space knows.
      savingsAccounts: {
        find: async (id: string) =>
          id === account
            ? { id, ownerUserId: fixture.userId, isSavings: true, archived: false, currency: "COP" }
            : null,
      },
      spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
      ids: new UuidV7IdGenerator(),
      clock: new FixedClock(later),
      tm,
    };
    const base = { spaceId: space.id, userId: fixture.userId, planId: plan.id };
    const [add, update, remove] = [
      createAddBudgetLine(deps),
      createUpdateBudgetLine(deps),
      createRemoveBudgetLine(deps),
    ];
    const edit = (lineId: string, changes: LineChanges, expectedVersion: number | null = null) =>
      update({ ...base, lineId, expectedVersion, changes });
    const drop = (lineId: string, expectedVersion: number | null = null) =>
      remove({ ...base, lineId, expectedVersion });
    // Everything these use cases may touch: the plan's version, its lines, and the mappings and values of its lines.
    const stored = async () => ({
      version: (await repo.find(space.id, plan.id))?.version,
      lines: (
        await pool.query(
          `SELECT name, planned_amount::text, funding, savings_account_ids, rollover_mode, is_catch_all,
             allocation_rule, deleted_at FROM budget_lines WHERE plan_id = $1 ORDER BY name`,
          [plan.id],
        )
      ).rows,
      mappings: (
        await pool.query("SELECT unmapped_at FROM budget_line_categories WHERE plan_id = $1", [plan.id])
      ).rows,
      allocations: (
        await pool.query(
          `SELECT superseded_at FROM budget_allocations WHERE line_id IN (SELECT id FROM budget_lines WHERE plan_id = $1)`,
          [plan.id],
        )
      ).rows,
    });

    const capacities = [{ memberId: fixture.memberId, amount: money(200_000_000n) }];
    unwrap(await createSetMemberCapacities(deps)({ ...base, expectedVersion: null, capacities }));
    const lines: [string, bigint][] = [
      ["Home", 100_000_000n],
      ["Gifts", 10_000_000n],
      ["Free", 5_000_000n],
    ];
    for (const [name, amount] of lines) {
      unwrap(await add({ ...base, expectedVersion: null, line: { name, plannedAmount: money(amount) } }));
    }
    const added = unwrap(
      await add({
        ...base,
        expectedVersion: null,
        line: {
          name: "Savings",
          plannedAmount: money(60_000_000n),
          funding: "SAVINGS",
          savingsAccountIds: [account],
        },
      }),
    );
    const id = (name: string) => added.figures.lines.find((l) => l.line.name === name)!.line.id;
    // Gifts maps a category and holds a FIXED value, which its removal must not touch beyond ending the mapping (D8).
    const groceries = await categoryFixture(db, fixture, "Groceries");
    await pool.query(
      "INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at) VALUES ($1, $2, $3, $4)",
      [plan.id, id("Gifts"), groceries, at],
    );
    await pool.query(
      "INSERT INTO budget_allocations (line_id, member_id, rule, value, set_at) VALUES ($1, $2, 'FIXED', '5', $3)",
      [id("Gifts"), fixture.memberId, at],
    );
    await pool.query("UPDATE budget_lines SET allocation_rule = 'FIXED' WHERE id = $1", [id("Gifts")]);

    // The home becomes the plan's catch-all House, Savings is renamed keeping its account, Gifts is removed.
    const house = {
      name: "House",
      plannedAmount: money(105_000_000n),
      funding: "SHARED_FUND" as const,
      rolloverMode: "ROLLOVER" as const,
      isCatchAll: true,
    };
    expect(unwrap(await edit(id("Home"), house)).plan.version).toBe(7);
    expect(unwrap(await edit(id("Savings"), { name: "Ahorro" })).plan.version).toBe(8);
    const removed = unwrap(await drop(id("Gifts")));
    expect(removed.plan.version).toBe(9);
    expect(removed.figures.lines.map((l) => l.line.name).sort()).toEqual(["Ahorro", "Free", "House"]);
    expect((await repo.contents(plan.id)).allocations).toEqual([]);
    const row = (name: string, planned: string, rest: Record<string, unknown>) => ({
      name,
      planned_amount: planned,
      funding: "DIRECT",
      savings_account_ids: [],
      rollover_mode: "RESET",
      is_catch_all: false,
      allocation_rule: "PROPORTIONAL",
      deleted_at: null,
      ...rest,
    });
    const written = {
      version: 9,
      lines: [
        row("Ahorro", "60000000", { funding: "SAVINGS", savings_account_ids: [account] }),
        row("Free", "5000000", {}),
        row("Gifts", "10000000", { allocation_rule: "FIXED", deleted_at: later }),
        row("House", "105000000", {
          funding: "SHARED_FUND",
          rollover_mode: "ROLLOVER",
          is_catch_all: true,
        }),
      ],
      mappings: [{ unmapped_at: later }],
      allocations: [{ superseded_at: null }],
    };
    expect(await stored()).toEqual(written);

    // All but the last two pass the lock and are refused afterwards; those are refused by the lock itself.
    const refused = [
      await edit(id("Home"), { plannedAmount: money(200_000_000n) }),
      await edit(id("Savings"), { name: "house" }),
      await edit(id("Free"), { isCatchAll: true }),
      await edit(id("Savings"), { isCatchAll: true }),
      await edit(id("Free"), { funding: "SAVINGS", savingsAccountIds: [account] }),
      await edit(id("Savings"), { savingsAccountIds: [account, other] }),
      await edit(id("Home"), { plannedAmount: money(1n, "USD") }),
      await edit(randomUUID(), { name: "Unknown" }),
      await edit("not-a-uuid", { name: "Unknown" }),
      await edit(id("Gifts"), { name: "Revived" }),
      await drop(randomUUID()),
      await drop(id("Gifts")),
      await edit(id("Home"), { name: "Late" }, 1),
      await drop(id("Home"), 1),
    ];
    expect(refused.map(codeOf)).toEqual([
      "PlanExceedsCapacity",
      "BudgetLineNameTaken",
      "CatchAllLineAlreadySet",
      "SavingsLineNotMappable",
      "SavingsAccountAlreadyUsed",
      "AccountNotFound",
      "CurrencyMismatch",
      "BudgetLineNotFound",
      "BudgetLineNotFound",
      "BudgetLineNotFound",
      "BudgetLineNotFound",
      "BudgetLineNotFound",
      "PreconditionFailed",
      "PreconditionFailed",
    ]);
    expect(await stored()).toEqual(written);
  });
});

describe("DrizzleBudgetPlanRepository category mappings (HU-E6-04, HU-E3-03, D8)", () => {
  it("replaces a line's categories and ends a removed line's mappings like its in-memory twin", async () => {
    const { space, fixture } = await household();
    const groceries = await categoryFixture(db, fixture, "Groceries");
    const utilities = await categoryFixture(db, fixture, "Utilities");
    const outings = await categoryFixture(db, fixture, "Outings");
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const home = aLine("Home", 147_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      createdAt: at,
    });
    const free = aLine("Free", 73_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      createdAt: new Date("2026-10-14T12:01:00Z"),
    });
    const run = async (plans: BudgetPlanRepository & BudgetLineRepository & CategoryMappingRepository) => {
      await plans.add(november);
      await plans.addLine(home, at);
      await plans.addLine(free, at);
      await plans.mapCategories(november.id, home.id, [groceries, utilities], at);
      await plans.mapCategories(november.id, home.id, [groceries], at);
      await plans.mapCategories(november.id, free.id, [utilities, outings], at);
      await plans.deleteLine(november.id, free.id, at);
      await plans.mapCategories(november.id, home.id, [groceries, outings], at);
      return {
        mappings: (await plans.contents(november.id)).mappings,
        mapped: [
          await plans.isCategoryMapped(utilities),
          await plans.isCategoryMapped(randomUUID()),
          await plans.isCategoryMapped("not-a-uuid"),
        ],
      };
    };
    const expected = {
      mappings: [
        { lineId: home.id, categoryId: groceries },
        { lineId: home.id, categoryId: outings },
      ].sort((a, b) => (a.categoryId < b.categoryId ? -1 : 1)),
      mapped: [true, false, false],
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM budget_line_categories WHERE plan_id = $1",
      [november.id],
    );
    expect(rows[0].n).toBe(5);
  });
});

describe("MapCategoriesToLine over PostgreSQL (HU-E6-04, Review Focus 5, 6, spec 7)", () => {
  it("replaces a line's categories logically and rolls the version lock back with a refused mapping, leaving every row as it was", async () => {
    const { space, fixture } = await household();
    const { fixture: elsewhere } = await household();
    const plan = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    await repo.add(plan);
    const [groceries, utilities, outings, restaurants, old] = [
      await categoryFixture(db, fixture, "Groceries"),
      await categoryFixture(db, fixture, "Utilities"),
      await categoryFixture(db, fixture, "Outings"),
      await categoryFixture(db, fixture, "Restaurants"),
      await categoryFixture(db, fixture, "Old"),
    ];
    // Another space's category, and one of Household's that is gone: the port lists neither.
    const [foreign, deleted] = [
      await categoryFixture(db, elsewhere, "Personal"),
      await categoryFixture(db, fixture, "Deleted"),
    ];
    const categories = {
      list: async (spaceId: string) =>
        spaceId === space.id
          ? [
              { id: groceries, archived: false },
              { id: utilities, archived: false },
              { id: outings, archived: false },
              { id: restaurants, archived: false },
              { id: old, archived: true },
            ]
          : [],
    };
    const spaces = new DrizzleSpaceRepository(tm);
    const account = randomUUID();
    const deps = {
      access: createSpaceAccess(spaces),
      members: spaces,
      plans: repo,
      capacities: repo,
      lines: repo,
      mappings: repo,
      categories,
      savingsAccounts: {
        find: async (id: string) =>
          id === account
            ? { id, ownerUserId: fixture.userId, isSavings: true, archived: false, currency: "COP" }
            : null,
      },
      spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
      ids: new UuidV7IdGenerator(),
      clock: new FixedClock(at),
      tm,
    };
    const base = { spaceId: space.id, userId: fixture.userId, planId: plan.id };
    const mapAt = (clock: Date) => createMapCategoriesToLine({ ...deps, clock: new FixedClock(clock) });
    const mapTo = (
      lineId: string,
      categoryIds: string[],
      expectedVersion: number | null = null,
      clock = later,
    ) => mapAt(clock)({ ...base, lineId, expectedVersion, categoryIds });
    // Everything this use case may touch: the plan's version and every mapping row, ended ones included.
    const stored = async () => ({
      version: (await repo.find(space.id, plan.id))?.version,
      mappings: (
        await pool.query(
          `SELECT l.name AS line, c.name AS category, m.mapped_at, m.unmapped_at
             FROM budget_line_categories m
             JOIN budget_lines l ON l.id = m.line_id
             JOIN categories c ON c.id = m.category_id
            WHERE m.plan_id = $1 ORDER BY c.name, m.mapped_at, l.name`,
          [plan.id],
        )
      ).rows,
    });

    unwrap(
      await createSetMemberCapacities(deps)({
        ...base,
        expectedVersion: null,
        capacities: [{ memberId: fixture.memberId, amount: money(200_000_000n) }],
      }),
    );
    const add = createAddBudgetLine(deps);
    unwrap(
      await add({
        ...base,
        expectedVersion: null,
        line: { name: "Home", plannedAmount: money(100_000_000n) },
      }),
    );
    unwrap(
      await add({
        ...base,
        expectedVersion: null,
        line: { name: "Free", plannedAmount: money(10_000_000n) },
      }),
    );
    unwrap(
      await add({
        ...base,
        expectedVersion: null,
        line: {
          name: "Savings",
          plannedAmount: money(60_000_000n),
          funding: "SAVINGS",
          savingsAccountIds: [account],
        },
      }),
    );
    const idOf = async (name: string) =>
      (await repo.contents(plan.id)).lines.find((l) => l.name === name)!.id;
    const [home, free, savings] = [await idOf("Home"), await idOf("Free"), await idOf("Savings")];
    const row = (line: string, category: string, mappedAt: Date, unmappedAt: Date | null) => ({
      line,
      category,
      mapped_at: mappedAt,
      unmapped_at: unmappedAt,
    });

    // Home takes Groceries and Utilities; sending the same set again, in another order, changes no row.
    expect(unwrap(await mapTo(home, [utilities, groceries], null, at)).plan.version).toBe(6);
    const first = await stored();
    expect(first).toEqual({
      version: 6,
      mappings: [row("Home", "Groceries", at, null), row("Home", "Utilities", at, null)],
    });
    expect(unwrap(await mapTo(home, [groceries, utilities, groceries])).plan.version).toBe(7);
    expect(await stored()).toEqual({ ...first, version: 7 });

    // Home keeps Groceries (its row untouched) and lets Utilities go; Free then takes it; Home takes Outings.
    unwrap(await mapTo(home, [groceries, outings]));
    unwrap(await mapTo(free, [utilities]));
    const written = {
      version: 9,
      mappings: [
        row("Home", "Groceries", at, null),
        row("Home", "Outings", later, null),
        row("Home", "Utilities", at, later),
        row("Free", "Utilities", later, null),
      ],
    };
    expect(await stored()).toEqual(written);

    // Review Focus 6: a removed line frees its categories and keeps its ended mappings.
    const remove = createRemoveBudgetLine({ ...deps, clock: new FixedClock(later) });
    unwrap(await remove({ ...base, lineId: free, expectedVersion: null }));
    unwrap(await mapTo(home, [groceries, outings, utilities]));
    expect(await stored()).toEqual({
      version: 11,
      mappings: [
        row("Home", "Groceries", at, null),
        row("Home", "Outings", later, null),
        row("Home", "Utilities", at, later),
        row("Free", "Utilities", later, later),
        row("Home", "Utilities", later, null),
      ],
    });

    // Each refusal passes the lock and is refused afterwards (the last by the lock itself), one bad id among good
    // ones: nothing is mapped, nothing is ended, and the version is the one before.
    unwrap(
      await add({
        ...base,
        expectedVersion: null,
        line: { name: "Trips", plannedAmount: money(5_000_000n) },
      }),
    );
    const trips = await idOf("Trips");
    const before = await stored();
    expect(before.version).toBe(12);
    const refused = [
      await mapTo(home, [groceries, restaurants, foreign]),
      await mapTo(home, [restaurants, deleted]),
      await mapTo(home, [restaurants, "not-a-uuid"]),
      await mapTo(home, [restaurants, randomUUID()]),
      await mapTo(home, [restaurants, old]),
      await mapTo(trips, [restaurants, outings]),
      await mapTo(savings, [restaurants]),
      await mapTo(free, [restaurants]),
      await mapTo(randomUUID(), [restaurants]),
      await mapTo("not-a-uuid", [restaurants]),
      await mapTo(home, [restaurants], 3),
    ];
    expect(refused.map(codeOf)).toEqual([
      "CategoryNotInSpace",
      "CategoryNotInSpace",
      "CategoryNotInSpace",
      "CategoryNotInSpace",
      "CategoryArchived",
      "CategoryAlreadyMapped",
      "SavingsLineNotMappable",
      "BudgetLineNotFound",
      "BudgetLineNotFound",
      "BudgetLineNotFound",
      "PreconditionFailed",
    ]);
    expect(await stored()).toEqual(before);
  });
});

describe("DrizzleBudgetPlanRepository allocations (HU-E6-05, D8)", () => {
  it("sets a line's rule and supersedes its earlier values like its in-memory twin", async () => {
    const { space, fixture } = await household();
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const free = aLine("Free", 73_000_000n, {
      id: randomUUID() as BudgetLineId,
      planId: november.id,
      createdAt: at,
    });
    const run = async (plans: BudgetPlanRepository & BudgetLineRepository & AllocationRepository) => {
      await plans.add(november);
      await plans.addLine(free, at);
      const split = [
        { memberId: fixture.memberId, value: 4200n },
        { memberId: pedro, value: 5800n },
      ];
      await plans.setAllocation(free.id, "PERCENT", split, at);
      await plans.setAllocation(free.id, "FIXED", [{ memberId: pedro, value: 73_000_000n }], at);
      const fixedParts = await plans.contents(november.id);
      await plans.setAllocation(free.id, "NONE", [], at);
      const noneParts = await plans.contents(november.id);
      return {
        fixed: [fixedParts.lines[0]!.allocationRule, fixedParts.allocations],
        none: [noneParts.lines[0]!.allocationRule, noneParts.allocations],
      };
    };
    const expected = {
      fixed: ["FIXED", [{ lineId: free.id, memberId: pedro, value: 73_000_000n }]],
      none: ["NONE", []],
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM budget_allocations WHERE line_id = $1 AND superseded_at IS NOT NULL",
      [free.id],
    );
    expect(rows[0].n).toBe(3);
  });
});

describe("AllocateBudgetLine over PostgreSQL (HU-E6-05, Review Focus 2, 6, spec 7)", () => {
  it("supersedes values logically, flags a line whose member left, and rolls the version lock back with a refused allocation, leaving every row as it was", async () => {
    const { space, fixture } = await household();
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const plan = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    await repo.add(plan);
    const spaces = new DrizzleSpaceRepository(tm);
    const deps = {
      access: createSpaceAccess(spaces),
      members: spaces,
      plans: repo,
      capacities: repo,
      lines: repo,
      allocations: repo,
      savingsAccounts: { find: async () => null },
      spending: { expensesByCategory: async () => [], transfersIntoAccounts: async () => [] },
      ids: new UuidV7IdGenerator(),
      clock: new FixedClock(at),
      tm,
    };
    const base = { spaceId: space.id, userId: fixture.userId, planId: plan.id };
    const [t3, t4, t5] = [
      new Date("2026-10-14T12:10:00Z"),
      new Date("2026-10-14T12:15:00Z"),
      new Date("2026-10-14T12:20:00Z"),
    ];
    const allocate = (
      lineId: string,
      allocation: AllocationInput,
      expectedVersion: number | null = null,
      clock = later,
    ) =>
      createAllocateBudgetLine({ ...deps, clock: new FixedClock(clock) })({
        ...base,
        lineId,
        expectedVersion,
        allocation,
      });
    const percent = (ana: number, guest: number): AllocationInput => ({
      rule: "PERCENT",
      members: [
        { memberId: fixture.memberId, basisPoints: ana },
        { memberId: pedro, basisPoints: guest },
      ],
    });
    const fixedHome = (ana: bigint, guest: bigint): AllocationInput => ({
      rule: "FIXED",
      members: [
        { memberId: fixture.memberId, amount: money(ana) },
        { memberId: pedro, amount: money(guest) },
      ],
    });
    // Everything this use case may touch: the plan's version, the rule of each line and every value row, superseded
    // ones included.
    const stored = async () => ({
      version: (await repo.find(space.id, plan.id))?.version,
      rules: (
        await pool.query("SELECT name, allocation_rule FROM budget_lines WHERE plan_id = $1 ORDER BY name", [
          plan.id,
        ])
      ).rows,
      values: (
        await pool.query(
          `SELECT l.name AS line, m.display_name AS member, a.rule, a.value::text, a.set_at, a.superseded_at
             FROM budget_allocations a
             JOIN budget_lines l ON l.id = a.line_id
             JOIN space_members m ON m.id = a.member_id
            WHERE l.plan_id = $1 ORDER BY l.name, a.set_at, m.display_name`,
          [plan.id],
        )
      ).rows,
    });
    const row = (
      line: string,
      member: string,
      rule: string,
      value: string,
      setAt: Date,
      supersededAt: Date | null,
    ) => ({ line, member, rule, value, set_at: setAt, superseded_at: supersededAt });
    const lineIn = (view: BudgetPlanView, name: string) =>
      view.figures.lines.find((l) => l.line.name === name)!;
    const assignedIn = (view: BudgetPlanView, name: string) =>
      Object.fromEntries(lineIn(view, name).allocation.members.map((m) => [m.memberId, m.assigned]));
    const invalidIn = (view: BudgetPlanView) =>
      Object.fromEntries(view.figures.lines.map((l) => [l.line.name, l.allocation.invalid]));

    unwrap(
      await createSetMemberCapacities(deps)({
        ...base,
        expectedVersion: null,
        capacities: [{ memberId: fixture.memberId, amount: money(200_000_000n) }],
      }),
    );
    const add = createAddBudgetLine(deps);
    for (const [name, amount] of [
      ["Home", 100_000_000n],
      ["Free", 73_000_000n],
    ] as const) {
      unwrap(await add({ ...base, expectedVersion: null, line: { name, plannedAmount: money(amount) } }));
    }
    const idOf = async (name: string) =>
      (await repo.contents(plan.id)).lines.find((l) => l.name === name)!.id;
    const [home, free] = [await idOf("Home"), await idOf("Free")];

    // Free is split 42 / 58 and 50 / 50 and then follows capacity; Home is fixed, set aside (NONE) and fixed again.
    const first = unwrap(await allocate(home, fixedHome(60_000_000n, 40_000_000n), null, at));
    expect(assignedIn(first, "Home")).toEqual({ [fixture.memberId]: 60_000_000n, [pedro]: 40_000_000n });
    unwrap(await allocate(free, percent(4200, 5800), null, at));
    unwrap(await allocate(free, percent(5000, 5000)));
    unwrap(await allocate(free, { rule: "PROPORTIONAL" }, null, t3));
    unwrap(await allocate(home, { rule: "NONE" }, null, t3));
    const view = unwrap(await allocate(home, fixedHome(60_000_000n, 40_000_000n), null, t4));
    expect(assignedIn(view, "Home")).toEqual({ [fixture.memberId]: 60_000_000n, [pedro]: 40_000_000n });
    const written = {
      version: 10,
      rules: [
        { name: "Free", allocation_rule: "PROPORTIONAL" },
        { name: "Home", allocation_rule: "FIXED" },
      ],
      values: [
        row("Free", "Ana", "PERCENT", "4200", at, later),
        row("Free", "Pedro", "PERCENT", "5800", at, later),
        row("Free", "Ana", "PERCENT", "5000", later, t3),
        row("Free", "Pedro", "PERCENT", "5000", later, t3),
        row("Home", "Ana", "FIXED", "60000000", at, t3),
        row("Home", "Pedro", "FIXED", "40000000", at, t3),
        row("Home", "Ana", "FIXED", "60000000", t4, null),
        row("Home", "Pedro", "FIXED", "40000000", t4, null),
      ],
    };
    expect(await stored()).toEqual(written);

    // Each refusal passes the lock and is refused afterwards (the last by the lock itself): nothing is superseded,
    // nothing is stored, and the version is the one before.
    const refused = [
      await allocate(free, percent(4200, 5700)),
      await allocate(home, fixedHome(60_000_000n, 39_999_900n)),
      await allocate(free, { rule: "PERCENT", members: [{ memberId: randomUUID(), basisPoints: 10_000 }] }),
      await allocate(free, { rule: "PERCENT", members: [{ memberId: "not-a-uuid", basisPoints: 10_000 }] }),
      await allocate(free, {
        rule: "FIXED",
        members: [{ memberId: pedro, amount: money(73_000_000n, "USD") }],
      }),
      await allocate(free, { rule: "PERCENT", members: [] }),
      await allocate(randomUUID(), { rule: "NONE" }),
      await allocate("not-a-uuid", { rule: "NONE" }),
      await allocate(free, { rule: "NONE" }, 3),
    ];
    expect(refused.map(codeOf)).toEqual([
      "InvalidAllocation",
      "InvalidAllocation",
      "NotASpaceMember",
      "NotASpaceMember",
      "CurrencyMismatch",
      "InvalidAllocation",
      "BudgetLineNotFound",
      "BudgetLineNotFound",
      "PreconditionFailed",
    ]);
    expect(await stored()).toEqual(written);

    // Review Focus 2: Pedro leaves. His rows stay, Home reads as InvalidAllocation and takes no value of his again
    // until it is allocated once more to the current members; Free, which follows capacity, is not affected.
    const read = createGetBudgetPlan(deps);
    expect(await spaces.markLeft(space.id, pedro as SpaceMemberId, "GUEST", later)).toBe(true);
    expect(invalidIn(unwrap(await read(base)))).toEqual({ Home: true, Free: false });
    expect(codeOf(await allocate(home, fixedHome(60_000_000n, 40_000_000n)))).toBe("NotASpaceMember");
    expect(await stored()).toEqual(written);
    const alone: AllocationInput = {
      rule: "FIXED",
      members: [{ memberId: fixture.memberId, amount: money(100_000_000n) }],
    };
    expect(invalidIn(unwrap(await allocate(home, alone, null, t5)))).toEqual({ Home: false, Free: false });
    expect(await stored()).toEqual({
      ...written,
      version: 11,
      values: [
        ...written.values.slice(0, 6),
        row("Home", "Ana", "FIXED", "60000000", t4, t5),
        row("Home", "Pedro", "FIXED", "40000000", t4, t5),
        row("Home", "Ana", "FIXED", "100000000", t5, null),
      ],
    });
  });
});
