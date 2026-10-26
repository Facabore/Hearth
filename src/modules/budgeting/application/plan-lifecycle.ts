import { domainError, err, ok, todayIn, type Result } from "@/shared/kernel";
import { closedOn, transitioned } from "../domain/plan";
import { activationCheck, planFigures } from "../domain/plan-figures";
import { carriesFromSource } from "../domain/rollover";
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
 *
 * Issue #158 (ruling P250, the mirror of P248): a DRAFT plan is not activated while a CLOSED plan copied from it
 * carries over from it (CopyAlreadyClosed, naming the copy's period). A copy of a DRAFT source carries 0 while the
 * source stays a draft (P248). Activating the source and closing it later would make the copy read its figures (P243),
 * and the copy's frozen 0 would jump. Refusing the activation keeps the CLOSED copy's figures still. This check runs
 * after the capacity and allocation ones.
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
      // Issue #183: the copies are locked, so a close of one in progress is waited for and seen (and one that starts
      // now waits for this activation, then sees the source ACTIVE and answers SourcePlanOpen).
      for (const copy of await deps.plans.lockCopiesOf(space.spaceId, plan.id)) {
        if (copy.status !== "CLOSED") continue;
        const copyParts = await deps.plans.contents(copy.id);
        if (carriesFromSource(copyParts.lines))
          return err(domainError("CopyAlreadyClosed", { copyPeriod: copy.period.label }));
      }
      await deps.statuses.setStatus(plan.id, "ACTIVE", deps.clock.now());
      return ok(await loadPlanView(deps, space, { ...plan, status: "ACTIVE" }));
    });

/**
 * HU-E6-07: an OWNER or ADMIN closes an ACTIVE plan once its period has ended (PeriodNotOver, P17 amended: today in
 * the deployment time zone must be after the period's last day). From then on neither the plan nor the space's
 * transactions dated within its period change (PeriodClosed, HU-E4-06); there is no reopening in v1.
 *
 * Ruling P248 (M6c): a plan is not closed while the plan it was copied from is ACTIVE and one of its lines carries
 * over from it (SourcePlanOpen, naming the source's period). A carry reads its source only once that source is
 * CLOSED (ruling P243), so closing the copy first would let its frozen figures jump when the source closes later.
 * The rule says "ACTIVE", not "not CLOSED", on purpose: a copy of a DRAFT source carries 0 while the source stays a
 * draft, and the activation guard (P250) keeps it a draft once this copy is CLOSED, so that 0 is stable and must not
 * block closing. The source is read without a lock: an activation of it in progress holds this copy FOR SHARE
 * (issue #183), so this close waits at its own version lock and then reads the source as committed. This check runs
 * after the transition and the period ones.
 */
export const createCloseBudgetPlan =
  (deps: CloseDeps): CloseBudgetPlan =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input, managePlan, (plan) =>
        closedOn(plan, todayIn(deps.clock, deps.timeZone)),
      );
      if (!write.ok) return write;
      const { space, plan, parts } = write.value;
      const source =
        plan.createdFrom !== null && carriesFromSource(parts.lines)
          ? await deps.plans.find(space.spaceId, plan.createdFrom)
          : null;
      if (source?.status === "ACTIVE") {
        return err(domainError("SourcePlanOpen", { sourcePeriod: source.period.label }));
      }
      await deps.statuses.setStatus(plan.id, "CLOSED", deps.clock.now());
      return ok(await loadPlanView(deps, space, { ...plan, status: "CLOSED" }));
    });
