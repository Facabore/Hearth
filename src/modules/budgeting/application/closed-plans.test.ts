import { describe, expect, it } from "vitest";
import type { LocalDate, Result } from "@/shared/kernel";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import { budgetingWorld, HOUSEHOLD, householdCategories } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import type { PlanStatus } from "../domain/plan";
import { createAddBudgetLine } from "./add-budget-line";
import { createAllocateBudgetLine } from "./allocate-budget-line";
import { createClosedPeriodGuard } from "./closed-periods";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createMapCategoriesToLine } from "./map-categories-to-line";
import { createRemoveBudgetLine } from "./remove-budget-line";
import { createSetMemberCapacities } from "./set-member-capacities";
import { createUpdateBudgetLine } from "./update-budget-line";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);

/**
 * The reference lines in Household's 2026-11 plan with `status`, 4,400,000 COP of capacity so that every write
 * below fits, and every M3-A write over it, in an order in which each succeeds on an editable plan.
 */
const world = async (status: PlanStatus) => {
  const w = budgetingWorld();
  const deps = {
    ...w.deps,
    capacities: w.plans,
    lines: w.plans,
    mappings: w.plans,
    allocations: w.plans,
    categories: householdCategories,
  };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 200_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines(),
  });
  await w.plans.setStatus(plan.id, status);
  const write = { spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, expectedVersion: null };
  const home = { ...write, lineId: "line-home" };
  const writes: [string, () => Promise<Result<unknown>>][] = [
    [
      "add a line",
      () => createAddBudgetLine(deps)({ ...write, line: { name: "Travel", plannedAmount: cop(1) } }),
    ],
    [
      "edit a line",
      () => createUpdateBudgetLine(deps)({ ...home, changes: { plannedAmount: cop(1_500_000) } }),
    ],
    ["map categories", () => createMapCategoriesToLine(deps)({ ...home, categoryIds: ["cat-groceries"] })],
    ["allocate a line", () => createAllocateBudgetLine(deps)({ ...home, allocation: { rule: "NONE" } })],
    ["remove a line", () => createRemoveBudgetLine(deps)({ ...write, lineId: "line-free" })],
    // Only one's own capacity is capacity.setOwn (OWNER Ana, MEMBER Juan); another member's takes plan.manage.
    [
      "set one's own capacity as the OWNER",
      () =>
        createSetMemberCapacities(deps)({
          ...write,
          capacities: [{ memberId: "member-ana", amount: cop(1_500_000) }],
        }),
    ],
    [
      "set another member's capacity",
      () =>
        createSetMemberCapacities(deps)({
          ...write,
          capacities: [{ memberId: "member-juan", amount: cop(2_400_000) }],
        }),
    ],
    [
      "set one's own capacity as a MEMBER",
      () =>
        createSetMemberCapacities(deps)({
          ...write,
          userId: "u-juan",
          capacities: [{ memberId: "member-juan", amount: cop(2_400_000) }],
        }),
    ],
  ];
  return { ...w, plan, writes };
};

const answersOf = async (writes: [string, () => Promise<Result<unknown>>][]) => {
  const answers: [string, string][] = [];
  for (const [what, write] of writes) answers.push([what, codeOf(await write())]);
  return answers;
};

describe("a CLOSED plan refuses every edit (HU-E6-07)", () => {
  it("answers PeriodClosed to every write of the plan or its parts, and changes no part", async () => {
    const { plans, plan, writes } = await world("CLOSED");
    const before = await plans.contents(plan.id);
    expect(await answersOf(writes)).toEqual(writes.map(([what]) => [what, "PeriodClosed"]));
    expect(await plans.contents(plan.id)).toEqual(before);
  });

  it.each<PlanStatus>(["DRAFT", "ACTIVE"])("lets a %s plan be edited", async (status) => {
    const { writes } = await world(status);
    expect(await answersOf(writes)).toEqual(writes.map(([what]) => [what, "ok"]));
  });
});

describe("the closed-period guard (HU-E4-06, HU-E6-07)", () => {
  it("closes exactly the stored dates of a CLOSED plan of the space", async () => {
    const { plans, plan } = await world("DRAFT");
    const guard = createClosedPeriodGuard(plans);
    const closed = (spaceId: string, date: string) => guard.isClosed(spaceId, date as LocalDate);
    // A period is open while its plan is a DRAFT or ACTIVE.
    expect(await closed(HOUSEHOLD, "2026-11-15")).toBe(false);
    await plans.setStatus(plan.id, "ACTIVE");
    expect(await closed(HOUSEHOLD, "2026-11-15")).toBe(false);
    await plans.setStatus(plan.id, "CLOSED");
    expect([
      await closed(HOUSEHOLD, "2026-10-31"),
      await closed(HOUSEHOLD, "2026-11-01"),
      await closed(HOUSEHOLD, "2026-11-30"),
      await closed(HOUSEHOLD, "2026-12-01"),
      await closed("space-ana", "2026-11-15"),
    ]).toEqual([false, true, true, false, false]);
  });
});
