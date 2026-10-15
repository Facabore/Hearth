import type { SpaceMembership } from "@/modules/spaces/application";
import type { BudgetPlan } from "../domain/plan";
import { planFigures, type PlanFigures } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";

/** A plan with every figure derived on read (D7), its amounts in the space currency. */
export interface BudgetPlanView {
  readonly plan: BudgetPlan;
  readonly currency: string;
  readonly figures: PlanFigures;
}

/** The plan's parts, its space's current members and the spending within its stored dates, as figures. */
export const loadPlanView = async (
  deps: Pick<BudgetingDeps, "members" | "plans" | "spending">,
  space: SpaceMembership,
  plan: BudgetPlan,
): Promise<BudgetPlanView> => {
  const members = await deps.members.listCurrent(space.spaceId);
  const parts = await deps.plans.contents(plan.id);
  const { start, end } = plan.period;
  const accountIds = parts.lines.flatMap((line) => line.savingsAccountIds);
  const spending = {
    byCategory: await deps.spending.expensesByCategory(space.spaceId, start, end),
    byAccount:
      accountIds.length === 0 ? [] : await deps.spending.transfersIntoAccounts(accountIds, start, end),
  };
  return {
    plan,
    currency: space.currency,
    figures: planFigures({ currency: space.currency, memberIds: members.map((m) => m.id), parts, spending }),
  };
};
