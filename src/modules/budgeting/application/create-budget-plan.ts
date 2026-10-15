import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, periodByLabel, type Result } from "@/shared/kernel";
import { openPlan } from "../domain/plan";
import type { BudgetingDeps } from "./deps";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

export type CreateBudgetPlan = (input: {
  spaceId: string;
  userId: string;
  period: string;
}) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-01: an OWNER or ADMIN creates a DRAFT plan for the period named `period` ("2026-11", "2026-11 H1"),
 * resolved with the space policy around the stored plans and stored as it is (D10); personal spaces too.
 */
export const createCreateBudgetPlan =
  (deps: BudgetingDeps): CreateBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "plan.manage");
      if (!manager.ok) return manager;
      const space = manager.value;
      const stored = await deps.plans.storedPeriods(space.spaceId);
      const period = periodByLabel(space.periodPolicy, stored, input.period);
      if (!period.ok) return period;
      const plan = openPlan({
        id: deps.ids.next<"BudgetPlan">(),
        spaceId: space.spaceId,
        period: period.value,
        stored,
        createdBy: input.userId,
        now: deps.clock.now(),
      });
      if (!plan.ok) return plan;
      // budget_plans_space_start_uq decides a concurrent creation of the same period.
      if (!(await deps.plans.add(plan.value))) {
        return err(domainError("PlanAlreadyExists", { label: period.value.label }));
      }
      return ok(await loadPlanView(deps, space, plan.value));
    });
