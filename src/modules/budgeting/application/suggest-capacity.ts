import { addDays, ok, resolvePeriod, type Period, type Result } from "@/shared/kernel";
import type { BudgetingDeps } from "./deps";
import { readablePlan } from "./plan-access";
import type { PreviousIncome } from "./ports";

export interface CapacitySuggestion {
  /** The caller's own member in the plan's space. */
  readonly memberId: string;
  /** The period before the plan's, in the space policy around the stored plans (spec 5.3). */
  readonly period: Period;
  /** Minor units of the space currency; null when the caller's personal space keeps another currency (D6). */
  readonly suggested: bigint | null;
  readonly currency: string;
}

export type SuggestCapacity = (input: {
  spaceId: string;
  userId: string;
  planId: string;
}) => Promise<Result<CapacitySuggestion>>;

/**
 * HU-E6-02, D17: the income the caller recorded in their personal space during the period before the plan's, as
 * a suggestion for their own capacity. Nothing is saved, and nobody else's income is ever read.
 */
export const createSuggestCapacity =
  (deps: BudgetingDeps & { readonly previousIncome: PreviousIncome }): SuggestCapacity =>
  async (input) => {
    const found = await readablePlan(deps, input);
    if (!found.ok) return found;
    const { space, plan } = found.value;
    const stored = await deps.plans.storedPeriods(space.spaceId);
    const previous = resolvePeriod(space.periodPolicy, stored, addDays(plan.period.start, -1));
    const income = await deps.previousIncome(input.userId, previous.start, previous.end);
    return ok({
      memberId: space.memberId,
      period: previous,
      suggested: income !== null && income.currency === space.currency ? income.amount : null,
      currency: space.currency,
    });
  };
