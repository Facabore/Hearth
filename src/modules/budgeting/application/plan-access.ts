import {
  authorizeSpaceAction,
  requirePermission,
  type SpaceMember,
  type SpaceMembership,
} from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { editablePlan, type BudgetPlan } from "../domain/plan";
import type { BudgetingDeps } from "./deps";
import type { PlanContents } from "./ports";

/** A plan of a space the user may read (space.read); archived spaces read too (HU-E1-09). */
export const readablePlan = async (
  deps: Pick<BudgetingDeps, "access" | "plans">,
  input: { readonly spaceId: string; readonly userId: string; readonly planId: string },
): Promise<Result<{ space: SpaceMembership; plan: BudgetPlan }>> => {
  const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
  if (!reader.ok) return reader;
  const plan = await deps.plans.find(reader.value.spaceId, input.planId);
  return plan === null ? err(domainError("BudgetPlanNotFound")) : ok({ space: reader.value, plan });
};

/** HU-E6-01 … HU-E6-07: writing a plan is the matrix action plan.manage (OWNER, ADMIN). */
export const managePlan = (membership: SpaceMembership): Result<SpaceMembership> =>
  requirePermission(membership, "plan.manage");

/** What a write to a plan sees once it holds the plan's version lock. */
export interface PlanWrite {
  readonly space: SpaceMembership;
  /** The plan as read after the lock (N4): its committed status and the version this write gives it (its ETag). */
  readonly plan: BudgetPlan;
  /** Current members in join order. */
  readonly members: readonly SpaceMember[];
  /** The plan's parts as committed before this write. */
  readonly parts: PlanContents;
}

/**
 * Every plan write starts here, inside its transaction: the membership (an archived space refuses, HU-E1-09), the
 * matrix (`authorize`), the plan, the version lock (If-Match, spec 7), the plan again, and only then the members
 * and parts, so writes to one plan run one at a time on committed data. The status rule (`accepts`: by default a
 * CLOSED plan refuses every edit, HU-E6-07) judges the plan read after the lock, never the one read before it
 * (preflight N4): a close committed while this write waited for the lock is seen.
 */
export const planForWrite = async (
  deps: Pick<BudgetingDeps, "access" | "members" | "plans" | "clock">,
  input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly planId: string;
    readonly expectedVersion: number | null;
  },
  authorize: (membership: SpaceMembership) => Result<SpaceMembership> = managePlan,
  accepts: (plan: BudgetPlan) => Result<unknown> = editablePlan,
): Promise<Result<PlanWrite>> => {
  const membership = await deps.access(input.spaceId, input.userId);
  if (!membership.ok) return membership;
  const allowed = authorize(membership.value);
  if (!allowed.ok) return allowed;
  const space = allowed.value;
  const found = await deps.plans.find(space.spaceId, input.planId);
  if (found === null) return err(domainError("BudgetPlanNotFound"));
  const version = await deps.plans.lockForWrite(found.id, input.expectedVersion, deps.clock.now());
  if (version === null) return err(domainError("PreconditionFailed"));
  // N4: read again under the lock. The version is only null-checked above: this read runs in the same transaction,
  // so it sees the version the lock just gave the plan (that is the ETag) and the status as committed.
  const plan = await deps.plans.find(space.spaceId, found.id);
  if (plan === null) return err(domainError("BudgetPlanNotFound"));
  const accepted = accepts(plan);
  if (!accepted.ok) return accepted;
  const members = await deps.members.listCurrent(space.spaceId);
  const parts = await deps.plans.contents(plan.id);
  return ok({ space, plan, members, parts });
};
