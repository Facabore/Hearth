import { domainError, err, ok, type Id, type Period, type Result, type StoredPeriod } from "@/shared/kernel";

export type BudgetPlanId = Id<"BudgetPlan">;
export const PLAN_STATUSES = ["DRAFT", "ACTIVE", "CLOSED"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Spec 5.2 BudgetPlan: one per period of the space's policy, its boundaries stored when it is created (D10). */
export interface BudgetPlan {
  readonly id: BudgetPlanId;
  readonly spaceId: string;
  readonly period: Period;
  /** HU-E6-07: DRAFT → ACTIVE → CLOSED; only ACTIVE plans drive splits (spec 5.3), CLOSED ones never change. */
  readonly status: PlanStatus;
  /** HU-E6-06: the plan this one was copied from; null for a plan created empty. */
  readonly createdFrom: BudgetPlanId | null;
  /** Bumped by every write to the plan or its parts; its ETag (spec 7, HU-E0-10). */
  readonly version: number;
  readonly createdBy: string;
  readonly createdAt: Date;
}

/**
 * HU-E6-01: a DRAFT plan for `period`, which `periodByLabel` resolved with the space policy around the stored
 * plan periods. That resolution returns a stored period for a label that already has a plan, so a period that
 * starts where a stored one starts already has its plan.
 */
export const openPlan = (input: {
  id: BudgetPlanId;
  spaceId: string;
  period: Period;
  stored: readonly StoredPeriod[];
  createdBy: string;
  now: Date;
}): Result<BudgetPlan> =>
  input.stored.some((s) => s.start === input.period.start)
    ? err(domainError("PlanAlreadyExists", { label: input.period.label }))
    : ok({
        id: input.id,
        spaceId: input.spaceId,
        period: input.period,
        status: "DRAFT",
        createdFrom: null,
        version: 1,
        createdBy: input.createdBy,
        createdAt: input.now,
      });

/** HU-E6-07: the only moves of a plan's status; nothing leaves CLOSED (no reopening in v1). */
const NEXT = new Map<PlanStatus, PlanStatus>([
  ["DRAFT", "ACTIVE"],
  ["ACTIVE", "CLOSED"],
]);

/** HU-E6-07: the plan moved to `to`; any other move is InvalidPlanTransition (ruling P12). */
export const transitioned = (plan: BudgetPlan, to: PlanStatus): Result<BudgetPlan> =>
  NEXT.get(plan.status) === to
    ? ok({ ...plan, status: to })
    : err(domainError("InvalidPlanTransition", { from: plan.status, to }));

/**
 * HU-E6-07: a CLOSED plan's figures are frozen, so neither the plan nor its parts change any more (PeriodClosed);
 * DRAFT and ACTIVE plans are edited (ruling P13).
 */
export const editablePlan = (plan: BudgetPlan): Result<BudgetPlan> =>
  plan.status === "CLOSED" ? err(domainError("PeriodClosed")) : ok(plan);
