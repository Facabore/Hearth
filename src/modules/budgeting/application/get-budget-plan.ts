import { ok, type Result } from "@/shared/kernel";
import type { BudgetingDeps } from "./deps";
import { readablePlan } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

export type GetBudgetPlan = (input: {
  spaceId: string;
  userId: string;
  planId: string;
}) => Promise<Result<BudgetPlanView>>;

/** HU-E6-01: any member reads a plan, archived spaces included, with every figure derived on read (D7). */
export const createGetBudgetPlan =
  (deps: BudgetingDeps): GetBudgetPlan =>
  async (input) => {
    const found = await readablePlan(deps, input);
    if (!found.ok) return found;
    return ok(await loadPlanView(deps, found.value.space, found.value.plan));
  };
