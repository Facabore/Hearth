import { ok, todayIn, type Result } from "@/shared/kernel";
import { closedOn, transitioned } from "../domain/plan";
import { activationCheck, planFigures } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import { managePlan, planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { PlanStatusRepository } from "./ports";

export interface PlanTransitionInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly planId: string;
  /** If-Match: the plan version the caller last read; null skips the check. */
  readonly expectedVersion: number | null;
}

export type ActivateBudgetPlan = (input: PlanTransitionInput) => Promise<Result<BudgetPlanView>>;
export type CloseBudgetPlan = (input: PlanTransitionInput) => Promise<Result<BudgetPlanView>>;

export type PlanStatusDeps = BudgetingDeps & { readonly statuses: PlanStatusRepository };

/** Closing also needs the deployment time zone (APP_TIMEZONE) that decides which day "today" is. */
export type CloseDeps = PlanStatusDeps & { readonly timeZone: string };

/** Activation rules depend on capacities, lines and allocations only. */
const NO_SPENDING = { byCategory: [], byAccount: [] };

/**
 * HU-E6-07: an OWNER or ADMIN activates a DRAFT plan while its lines fit its capacity (PlanExceedsCapacity) and
 * every allocation holds (InvalidAllocation, naming the lines). From then on it drives default splits (HU-E6-08).
 */
export const createActivateBudgetPlan =
  (deps: PlanStatusDeps): ActivateBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input, managePlan, (plan) => transitioned(plan, "ACTIVE"));
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const figures = planFigures({
        currency: space.currency,
        memberIds: members.map((m) => m.id),
        parts,
        spending: NO_SPENDING,
      });
      const valid = activationCheck(figures);
      if (!valid.ok) return valid;
      await deps.statuses.setStatus(plan.id, "ACTIVE", deps.clock.now());
      return ok(await loadPlanView(deps, space, { ...plan, status: "ACTIVE" }));
    });

/**
 * HU-E6-07: an OWNER or ADMIN closes an ACTIVE plan once its period has ended (PeriodNotOver, P17 amended: today in
 * the deployment time zone must be after the period's last day). From then on neither the plan nor the space's
 * transactions dated within its period change (PeriodClosed, HU-E4-06); there is no reopening in v1.
 */
export const createCloseBudgetPlan =
  (deps: CloseDeps): CloseBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input, managePlan, (plan) =>
        closedOn(plan, todayIn(deps.clock, deps.timeZone)),
      );
      if (!write.ok) return write;
      const { space, plan } = write.value;
      await deps.statuses.setStatus(plan.id, "CLOSED", deps.clock.now());
      return ok(await loadPlanView(deps, space, { ...plan, status: "CLOSED" }));
    });
