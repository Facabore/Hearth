import type { StoredPeriod } from "@/shared/kernel";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import type { PlanParts } from "../domain/plan-figures";

/** A plan's capacities, lines that are not deleted, current category mappings and current allocation values. */
export type PlanContents = PlanParts;

/** HU-E6-01: plans and the version lock every write to a plan takes (spec 7). */
export interface BudgetPlanRepository {
  /** Stores a new plan; false when the space already has a plan starting that day (a concurrent creation). */
  add(plan: BudgetPlan): Promise<boolean>;
  /** A plan of the space; null for unknown or malformed ids and for another space's plan. */
  find(spaceId: string, planId: string): Promise<BudgetPlan | null>;
  /** D10: the stored boundaries of the space's plans, oldest first; `[]` for malformed ids. */
  storedPeriods(spaceId: string): Promise<StoredPeriod[]>;
  /** D6, HU-E1-03: whether the space has a plan, whose amounts are in the space currency; false for malformed ids. */
  hasPlans(spaceId: string): Promise<boolean>;
  /**
   * Starts a write inside the caller's transaction: locks the plan row (FOR NO KEY UPDATE), bumps its version and
   * returns the new one. Writers of one plan queue here until the holder's transaction ends and then see its committed
   * work, so reads of the plan after this call are current and stay so. Null when the plan does not exist, when
   * `expectedVersion` is given and is not current (If-Match), or when the version changed between the check and the
   * bump (possible only outside a transaction, which holds no lock).
   */
  lockForWrite(planId: BudgetPlanId, expectedVersion: number | null, at: Date): Promise<number | null>;
  /** Capacities by member; lines that are not deleted in creation order; current mappings and values by line. */
  contents(planId: BudgetPlanId): Promise<PlanContents>;
}
