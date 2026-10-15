import { authorizeSpaceAction, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, periodByLabel, type Result } from "@/shared/kernel";
import { openPlan, type BudgetPlan } from "../domain/plan";
import type { BudgetingDeps } from "./deps";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

/** HU-E6-01, HU-E6-06: who asks for a new plan, and for which period. */
export interface NewPlanInput {
  readonly spaceId: string;
  readonly userId: string;
  /** The period's label in the space policy: "2026-11" (MONTHLY) or "2026-11 H1" (SEMI_MONTHLY). */
  readonly period: string;
}

export type CreateBudgetPlan = (input: NewPlanInput) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-01, HU-E6-06: the DRAFT plan an OWNER or ADMIN may create for the period named `period`, resolved with the
 * space policy around the stored plans (D10), not stored yet; personal spaces too.
 */
export const openedPlan = async (
  deps: Pick<BudgetingDeps, "access" | "plans" | "ids" | "clock">,
  input: NewPlanInput,
): Promise<Result<{ space: SpaceMembership; plan: BudgetPlan }>> => {
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
  return plan.ok ? ok({ space, plan: plan.value }) : plan;
};

/** HU-E6-01: an OWNER or ADMIN creates an empty DRAFT plan for a period, its boundaries stored as they are (D10). */
export const createCreateBudgetPlan =
  (deps: BudgetingDeps): CreateBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const opened = await openedPlan(deps, input);
      if (!opened.ok) return opened;
      const { space, plan } = opened.value;
      // budget_plans_space_start_uq decides a concurrent creation of the same period.
      if (!(await deps.plans.add(plan))) {
        return err(domainError("PlanAlreadyExists", { label: plan.period.label }));
      }
      return ok(await loadPlanView(deps, space, plan));
    });
