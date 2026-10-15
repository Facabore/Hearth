import { ok, type Result } from "@/shared/kernel";
import type { BudgetingDeps } from "./deps";
import { lineOf } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { BudgetLineRepository } from "./ports";

export type RemoveBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
}) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-03, D8: removing a line is logical: its row stays with deletedAt, it leaves every figure, and its name and
 * categories are free again. Lowering what is planned never needs a capacity check.
 */
export const createRemoveBudgetLine =
  (deps: BudgetingDeps & { readonly lines: BudgetLineRepository }): RemoveBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const line = lineOf(write.value.parts, input.lineId);
      if (!line.ok) return line;
      await deps.lines.deleteLine(write.value.plan.id, line.value.id, deps.clock.now());
      return ok(await loadPlanView(deps, write.value.space, write.value.plan));
    });
