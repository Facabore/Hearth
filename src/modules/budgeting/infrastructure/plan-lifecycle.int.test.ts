import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { InMemoryBudgetPlans } from "../../../../tests/support/in-memory-budgeting";
import type { BudgetPlanRepository, PlanStatusRepository } from "../application/ports";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import { DrizzleBudgetPlanRepository } from "./drizzle-budget-plan-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleBudgetPlanRepository(new DrizzleTransactionManager(db));
const at = new Date("2026-10-15T12:00:00Z");
const later = new Date("2026-12-01T12:00:00Z");

afterAll(() => pool.end());

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

describe("DrizzleBudgetPlanRepository plans by date and status (HU-E6-06, HU-E6-07, HU-E6-08)", () => {
  it("finds the plan covering a date, its edges included, and changes its status like its in-memory twin", async () => {
    const ana = await userFixture(pool, "Ana");
    const space = await sharedSpaceFixture(db, ana.id);
    const elsewhere = await sharedSpaceFixture(db, ana.id);
    const november = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const december = aPlan(space.id, "2026-12", "2026-12-01", "2026-12-31");
    // January has no plan: the days around the gap are covered by nothing.
    const february = aPlan(space.id, "2027-02", "2027-02-01", "2027-02-28");
    const novemberElsewhere = aPlan(elsewhere.id, "2026-11", "2026-11-01", "2026-11-30");
    const run = async (plans: BudgetPlanRepository & PlanStatusRepository) => {
      for (const plan of [november, december, february, novemberElsewhere]) await plans.add(plan);
      const covering = async (spaceId: string, date: string, share = false) =>
        (await plans.covering(spaceId, date as LocalDate, { share }))?.id ?? null;
      const found = [
        await covering(space.id, "2026-10-31"),
        await covering(space.id, "2026-11-01"),
        await covering(space.id, "2026-11-15"),
        await covering(space.id, "2026-11-30", true),
        await covering(space.id, "2026-12-01"),
        await covering(space.id, "2026-12-31"),
        await covering(space.id, "2027-01-01"),
        await covering(space.id, "2027-01-31"),
        await covering(space.id, "2027-02-01", true),
        await covering(space.id, "2027-02-28"),
        await covering(space.id, "2027-03-01"),
        await covering(elsewhere.id, "2026-11-15"),
        await covering(elsewhere.id, "2026-12-01"),
        await covering(randomUUID(), "2026-11-15"),
        await covering("not-a-uuid", "2026-11-15"),
      ];
      await plans.setStatus(november.id, "ACTIVE", at);
      const active = await plans.covering(space.id, "2026-11-15" as LocalDate);
      await plans.setStatus(november.id, "CLOSED", later);
      const closed = await plans.covering(space.id, "2026-11-30" as LocalDate, { share: true });
      // A plan nobody has: nothing changes and nothing fails.
      await plans.setStatus(randomUUID() as BudgetPlanId, "CLOSED", later);
      const untouched = await plans.find(space.id, december.id);
      const otherSpace = await plans.find(elsewhere.id, novemberElsewhere.id);
      return {
        found,
        statuses: [active?.status, closed?.status],
        december: untouched?.status,
        elsewhere: otherSpace?.status,
      };
    };
    const expected = {
      found: [
        null,
        november.id,
        november.id,
        november.id,
        december.id,
        december.id,
        null,
        null,
        february.id,
        february.id,
        null,
        novemberElsewhere.id,
        null,
        null,
        null,
      ],
      // The status never hides a plan: a closed period is still the one covering its days.
      statuses: ["ACTIVE", "CLOSED"],
      december: "DRAFT",
      elsewhere: "DRAFT",
    };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query("SELECT status, updated_at FROM budget_plans WHERE id = $1", [
      november.id,
    ]);
    expect(rows[0]).toEqual({ status: "CLOSED", updated_at: later });
  });

  it("changes the status and the update time only, leaving the version the lock gave", async () => {
    const ana = await userFixture(pool, "Ana");
    const space = await sharedSpaceFixture(db, ana.id);
    const plan = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const run = async (plans: BudgetPlanRepository & PlanStatusRepository) => {
      await plans.add(plan);
      const locked = await plans.lockForWrite(plan.id, 1, at);
      await plans.setStatus(plan.id, "ACTIVE", later);
      const stored = await plans.find(space.id, plan.id);
      return { locked, stored };
    };
    const expected = { locked: 2, stored: { ...plan, status: "ACTIVE", version: 2 } };
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
    const { rows } = await pool.query(
      "SELECT version, status, label, start_date::text AS start_date, end_date::text AS end_date, updated_at FROM budget_plans WHERE id = $1",
      [plan.id],
    );
    expect(rows[0]).toEqual({
      version: 2,
      status: "ACTIVE",
      label: "2026-11",
      start_date: "2026-11-01",
      end_date: "2026-11-30",
      updated_at: later,
    });
  });

  it("answers the plan starting latest when stored periods overlap, which D10 should never allow", async () => {
    const ana = await userFixture(pool, "Ana");
    const space = await sharedSpaceFixture(db, ana.id);
    const wholeMonth = aPlan(space.id, "2026-11", "2026-11-01", "2026-11-30");
    const secondHalf = aPlan(space.id, "2026-11 H2", "2026-11-16", "2026-11-30");
    const run = async (plans: BudgetPlanRepository) => {
      await plans.add(wholeMonth);
      await plans.add(secondHalf);
      const covering = async (date: string) =>
        (await plans.covering(space.id, date as LocalDate))?.id ?? null;
      return [await covering("2026-11-10"), await covering("2026-11-16"), await covering("2026-11-30")];
    };
    const expected = [wholeMonth.id, secondHalf.id, secondHalf.id];
    expect(await run(new InMemoryBudgetPlans())).toEqual(expected);
    expect(await run(repo)).toEqual(expected);
  });
});
