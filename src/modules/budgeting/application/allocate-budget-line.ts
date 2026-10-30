import { ok, type Result } from "@/shared/kernel";
import { checkedAllocation, type AllocationInput } from "../domain/allocation";
import type { BudgetingDeps } from "./deps";
import { lineOf } from "./line-checks";
import { planForWrite, viewerIdsOf } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { AllocationRepository } from "./ports";

export type AllocateBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
  allocation: AllocationInput;
}) => Promise<Result<BudgetPlanView>>;

export type AllocationDeps = BudgetingDeps & { readonly allocations: AllocationRepository };

/**
 * HU-E6-05: an OWNER or ADMIN allocates a line among the current members: proportionally to capacity (the
 * default), by percentage, by fixed amount, or not at all (NONE, group money). Assigned amounts are derived on read.
 */
export const createAllocateBudgetLine =
  (deps: AllocationDeps): AllocateBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const line = lineOf(parts, input.lineId);
      if (!line.ok) return line;
      const allocation = checkedAllocation(
        input.allocation,
        line.value,
        members.map((m) => m.id),
        space.currency,
        viewerIdsOf(members),
      );
      if (!allocation.ok) return allocation;
      await deps.allocations.setAllocation(
        plan.id,
        line.value.id,
        allocation.value.rule,
        allocation.value.values,
        deps.clock.now(),
      );
      return ok(await loadPlanView(deps, space, plan));
    });
