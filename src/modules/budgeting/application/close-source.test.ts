import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { aLine } from "../../../../tests/support/budget-fixtures";
import {
  BUDGET_MEMBERS,
  budgetingWorld,
  HOUSEHOLD,
  householdCategories,
} from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import type { BudgetLineId, RolloverMode } from "../domain/budget-line";
import { createCopyBudgetPlan } from "./copy-budget-plan";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createGetBudgetPlan } from "./get-budget-plan";
import { createActivateBudgetPlan, createCloseBudgetPlan } from "./plan-lifecycle";
import type { PlanSpending } from "./ports";

const ANA_AND_JUAN = BUDGET_MEMBERS.filter((m) => m.displayName === "Ana" || m.displayName === "Juan");
const pesos = (n: number) => BigInt(n) * 100n;

/** 2027-02-05 at noon in Bogota: every period from 2026-11 to 2027-01 has ended, so any of them may close. */
const FEBRUARY = new Date("2027-02-05T17:00:00Z");

class SpendingByPeriod implements PlanSpending {
  constructor(private readonly groceriesFrom: Readonly<Record<string, bigint>>) {}
  async expensesByCategory(_spaceId: string, from: string) {
    const amount = this.groceriesFrom[from];
    return amount === undefined ? [] : [{ categoryId: "cat-groceries", amount }];
  }
  async transfersIntoAccounts() {
    return [];
  }
}

/**
 * Ruling P248 (M6c): Household's 2026-11 plan with Home (`mode`) mapped to Groceries, 1,270,000 COP spent in November
 * and 1,500,000 COP in December, read on 2027-02-05; later plans are copies. The real activate and close run.
 */
const world = async (mode: RolloverMode) => {
  const w = budgetingWorld({ members: ANA_AND_JUAN });
  const deps = {
    ...w.deps,
    spending: new SpendingByPeriod({ "2026-11-01": pesos(1_270_000), "2026-12-01": pesos(1_500_000) }),
    capacities: w.plans,
    lines: w.plans,
    mappings: w.plans,
    allocations: w.plans,
    categories: householdCategories,
    clock: new FixedClock(FEBRUARY),
    timeZone: "America/Bogota",
    statuses: w.plans,
  };
  const november = unwrap(
    await createCreateBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" }),
  ).plan;
  w.plans.seed(november.id, {
    capacities: [{ memberId: "member-ana", amount: 400_000_000n }],
    lines: [aLine("Home", 147_000_000n, { rolloverMode: mode })],
    mappings: [{ lineId: "line-home", categoryId: "cat-groceries" }],
  });
  const input = (planId: string) => ({ spaceId: HOUSEHOLD, userId: "u-ana", planId, expectedVersion: null });
  const copyInto = async (period: string) =>
    unwrap(await createCopyBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period })).view;
  const activate = (planId: string) => createActivateBudgetPlan(deps)(input(planId));
  const close = (planId: string) => createCloseBudgetPlan(deps)(input(planId));
  const read = async (planId: string) =>
    unwrap(await createGetBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", planId }));
  const status = async (planId: string) => (await w.plans.find(HOUSEHOLD, planId))?.status;
  /** Home's [carry-over, available, source closed?] as the plan answers it now. */
  const homeOf = async (planId: string) => {
    const [line] = (await read(planId)).figures.lines;
    return [line!.carryOver, line!.available, line!.carryOverFrom?.closed ?? null] as const;
  };
  return { ...w, november, copyInto, activate, close, read, status, homeOf };
};

describe("closing a plan whose carries read from an open source (ruling P248 of M6c)", () => {
  it.each(["ROLLOVER", "ADJUSTED"] as const)(
    "refuses to close a %s copy of an ACTIVE November with SourcePlanOpen, naming 2026-11, and leaves it ACTIVE",
    async (mode) => {
      const w = await world(mode);
      unwrap(await w.activate(w.november.id));
      const december = await w.copyInto("2026-12");
      unwrap(await w.activate(december.plan.id));
      const result = await w.close(december.plan.id);
      expect(codeOf(result)).toBe("SourcePlanOpen");
      expect(!result.ok && result.error.details).toEqual({ sourcePeriod: "2026-11" });
      expect(await w.status(december.plan.id)).toBe("ACTIVE");
      // The figures the refusal protects: December shows no carry yet, and nothing moved.
      expect(await w.homeOf(december.plan.id)).toEqual([0n, pesos(-30_000), false]);
    },
  );

  it("closes the source first, then the copy: December's figures are the same ones from then on", async () => {
    const w = await world("ROLLOVER");
    unwrap(await w.activate(w.november.id));
    const december = await w.copyInto("2026-12");
    unwrap(await w.activate(december.plan.id));
    unwrap(await w.close(w.november.id));
    const closed = unwrap(await w.close(december.plan.id));
    const frozen = [pesos(200_000), pesos(170_000), true];
    expect(await w.homeOf(december.plan.id)).toEqual(frozen);
    expect(closed.figures.lines[0]!.carryOver).toBe(pesos(200_000));
    // January copies the closed December and closes after it; nothing of December moves.
    const january = await w.copyInto("2027-01");
    unwrap(await w.activate(january.plan.id));
    unwrap(await w.close(january.plan.id));
    expect(await w.homeOf(december.plan.id)).toEqual(frozen);
    expect(await w.homeOf(w.november.id)).toEqual([0n, pesos(200_000), null]);
  });

  it("refuses an open source only after the transition and the period: a DRAFT copy still answers InvalidPlanTransition", async () => {
    const w = await world("ROLLOVER");
    unwrap(await w.activate(w.november.id));
    const december = await w.copyInto("2026-12");
    expect(codeOf(await w.close(december.plan.id))).toBe("InvalidPlanTransition");
  });

  it("closes an all-RESET copy of an open source as before", async () => {
    const w = await world("RESET");
    unwrap(await w.activate(w.november.id));
    const december = await w.copyInto("2026-12");
    unwrap(await w.activate(december.plan.id));
    expect(unwrap(await w.close(december.plan.id)).plan.status).toBe("CLOSED");
  });

  it("closes a copy whose only ROLLOVER line has no origin: nothing carries from the source", async () => {
    const w = await world("RESET");
    unwrap(await w.activate(w.november.id));
    const december = await w.copyInto("2026-12");
    w.plans.seed(december.plan.id, {
      lines: [aLine("Pets", pesos(100_000), { id: "line-pets" as BudgetLineId, rolloverMode: "ROLLOVER" })],
    });
    unwrap(await w.activate(december.plan.id));
    expect(codeOf(await w.close(december.plan.id))).toBe("ok");
  });

  it("closes a ROLLOVER copy of a DRAFT source, which never closes, and it carries 0 for good", async () => {
    const w = await world("ROLLOVER");
    const december = await w.copyInto("2026-12");
    unwrap(await w.activate(december.plan.id));
    const closed = unwrap(await w.close(december.plan.id));
    expect(closed.plan.status).toBe("CLOSED");
    expect(await w.homeOf(december.plan.id)).toEqual([0n, pesos(-30_000), false]);
  });

  it("closes a copy whose source is gone from the space's plans", async () => {
    const w = await world("ROLLOVER");
    unwrap(await w.activate(w.november.id));
    const december = await w.copyInto("2026-12");
    unwrap(await w.activate(december.plan.id));
    w.plans.plans = w.plans.plans.map((p) =>
      p.id === december.plan.id ? { ...p, createdFrom: "plan-missing" as typeof p.createdFrom } : p,
    );
    expect(codeOf(await w.close(december.plan.id))).toBe("ok");
  });
});
