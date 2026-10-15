import { requirePermission, type SpaceMembership } from "@/modules/spaces/application";
import { ok, type Money, type Result } from "@/shared/kernel";
import { checkedCapacities } from "../domain/capacity";
import type { BudgetingDeps } from "./deps";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { CapacityRepository } from "./ports";

export interface SetMemberCapacitiesInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly planId: string;
  /** If-Match: the plan version the caller last read; null skips the check. */
  readonly expectedVersion: number | null;
  readonly capacities: readonly { readonly memberId: string; readonly amount: Money }[];
}

export type SetMemberCapacities = (input: SetMemberCapacitiesInput) => Promise<Result<BudgetPlanView>>;

export type CapacityDeps = BudgetingDeps & { readonly capacities: CapacityRepository };

/**
 * HU-E6-02, D17: OWNER and ADMIN set anyone's capacity (plan.manage); a registered MEMBER sets only their own
 * (capacity.setOwn). Members not listed keep theirs; proportional assignments follow on the next read.
 */
export const createSetMemberCapacities =
  (deps: CapacityDeps): SetMemberCapacities =>
  (input) =>
    deps.tm.run(async () => {
      const onlyOwn = (m: SpaceMembership) => input.capacities.every((c) => c.memberId === m.memberId);
      const write = await planForWrite(deps, input, (m) =>
        requirePermission(m, onlyOwn(m) ? "capacity.setOwn" : "plan.manage"),
      );
      if (!write.ok) return write;
      const { space, plan, members } = write.value;
      const capacities = checkedCapacities(
        input.capacities,
        members.map((m) => m.id),
        space.currency,
      );
      if (!capacities.ok) return capacities;
      await deps.capacities.setCapacities(plan.id, capacities.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
