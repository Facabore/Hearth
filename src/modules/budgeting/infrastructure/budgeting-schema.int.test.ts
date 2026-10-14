import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import {
  categoryFixture,
  guestMemberFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();

afterAll(() => pool.end());

const plan = (spaceId: string, label: string, start: string, end: string, id: string = randomUUID()) =>
  pool.query(
    `INSERT INTO budget_plans (id, space_id, label, start_date, end_date, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'DRAFT', 'u-ana', now(), now())`,
    [id, spaceId, label, start, end],
  );

interface LineOptions {
  readonly funding?: string;
  readonly accounts?: string[];
  readonly catchAll?: boolean;
  readonly deleted?: boolean;
  readonly planned?: string;
}
const line = (planId: string, name: string, o: LineOptions = {}, id: string = randomUUID()) =>
  pool.query(
    `INSERT INTO budget_lines (id, plan_id, name, planned_amount, funding, savings_account_ids, rollover_mode,
       is_catch_all, allocation_rule, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6::uuid[], 'RESET', $7, 'PROPORTIONAL', now(), now(), $8)`,
    [
      id,
      planId,
      name,
      o.planned ?? "100",
      o.funding ?? "DIRECT",
      o.accounts ?? [],
      o.catchAll ?? false,
      o.deleted ? new Date() : null,
    ],
  );

/** Household with Ana as OWNER and a DRAFT plan for 2026-11. */
const world = async () => {
  const ana = await userFixture(pool, "Ana");
  const space = await sharedSpaceFixture(db, ana.id);
  const fixture = { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id };
  const planId = randomUUID();
  await plan(space.id, "2026-11", "2026-11-01", "2026-11-30", planId);
  return { space, fixture, planId };
};

describe("budget_plans (HU-E6-01, D10)", () => {
  it("keeps one plan per period start in a space, with ordered boundaries", async () => {
    const { space } = await world();
    await expect(plan(space.id, "2026-11", "2026-11-01", "2026-11-30")).rejects.toThrow(
      /budget_plans_space_start_uq/,
    );
    await expect(plan(space.id, "2026-12", "2026-12-31", "2026-12-01")).rejects.toThrow(/budget_plans_dates/);
    const other = await sharedSpaceFixture(db, (await userFixture(pool, "Juan")).id);
    await expect(plan(other.id, "2026-11", "2026-11-01", "2026-11-30")).resolves.toBeDefined();
  });
});

describe("budget_member_capacities (HU-E6-02, D15)", () => {
  it("holds one non-negative capacity per member of a plan, guests included", async () => {
    const { fixture, planId } = await world();
    const pedro = await guestMemberFixture(pool, fixture, "Pedro");
    const capacity = (memberId: string, amount: string) =>
      pool.query(
        "INSERT INTO budget_member_capacities (plan_id, member_id, amount, updated_at) VALUES ($1, $2, $3, now())",
        [planId, memberId, amount],
      );
    await expect(capacity(pedro, "30000000")).resolves.toBeDefined();
    await expect(capacity(fixture.memberId, "-1")).rejects.toThrow(/budget_member_capacities_amount/);
    await expect(capacity(pedro, "1")).rejects.toThrow(/duplicate key/);
  });
});

describe("budget_lines (HU-E6-03, HU-E6-04, D8)", () => {
  it("keeps names unique ignoring case among lines that are not deleted", async () => {
    const { planId } = await world();
    await line(planId, "Home", { deleted: true });
    await expect(line(planId, "home")).resolves.toBeDefined();
    await expect(line(planId, "HOME")).rejects.toThrow(/budget_lines_plan_name_uq/);
  });

  it("allows one catch-all line per plan among lines that are not deleted", async () => {
    const { planId } = await world();
    await line(planId, "Old free", { catchAll: true, deleted: true });
    await line(planId, "Free", { catchAll: true });
    await expect(line(planId, "Other", { catchAll: true })).rejects.toThrow(/budget_lines_catch_all_uq/);
  });

  it("names savings accounts on SAVINGS lines and on no other, never makes them catch-all, plans positive amounts", async () => {
    const { planId } = await world();
    await expect(line(planId, "Savings", { funding: "SAVINGS" })).rejects.toThrow(
      /budget_lines_savings_accounts/,
    );
    await expect(line(planId, "Home", { accounts: [randomUUID()] })).rejects.toThrow(
      /budget_lines_savings_accounts/,
    );
    await expect(
      line(planId, "Savings", { funding: "SAVINGS", accounts: [randomUUID()], catchAll: true }),
    ).rejects.toThrow(/budget_lines_savings_catch_all/);
    await expect(line(planId, "Gifts", { planned: "0" })).rejects.toThrow(/budget_lines_planned_positive/);
    await expect(
      line(planId, "Savings", { funding: "SAVINGS", accounts: [randomUUID()] }),
    ).resolves.toBeDefined();
  });
});

describe("budget_line_categories (HU-E6-04, D8)", () => {
  it("maps a category to one current line per plan; ended mappings stay and free it", async () => {
    const { fixture, planId } = await world();
    const [home, free] = [randomUUID(), randomUUID()];
    await line(planId, "Home", {}, home);
    await line(planId, "Free", {}, free);
    const groceries = await categoryFixture(db, fixture);
    const map = (lineId: string, ended = false) =>
      pool.query(
        "INSERT INTO budget_line_categories (plan_id, line_id, category_id, mapped_at, unmapped_at) VALUES ($1, $2, $3, now(), $4)",
        [planId, lineId, groceries, ended ? new Date() : null],
      );
    await map(home, true);
    await map(free);
    await expect(map(home)).rejects.toThrow(/budget_line_categories_current_uq/);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM budget_line_categories WHERE category_id = $1",
      [groceries],
    );
    expect(rows[0].n).toBe(2);
  });
});

describe("budget_allocations (HU-E6-05, D8)", () => {
  it("holds one current positive value per member of a line; superseded values stay", async () => {
    const { fixture, planId } = await world();
    const free = randomUUID();
    await line(planId, "Free", {}, free);
    const value = (amount: string, superseded = false) =>
      pool.query(
        "INSERT INTO budget_allocations (line_id, member_id, rule, value, set_at, superseded_at) VALUES ($1, $2, 'PERCENT', $3, now(), $4)",
        [free, fixture.memberId, amount, superseded ? new Date() : null],
      );
    await value("4200", true);
    await value("10000");
    await expect(value("5000")).rejects.toThrow(/budget_allocations_current_uq/);
    await expect(value("0", true)).rejects.toThrow(/budget_allocations_value_positive/);
  });
});
