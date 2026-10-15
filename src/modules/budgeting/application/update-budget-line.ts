import { ok, type Money, type Result } from "@/shared/kernel";
import { reviseLine, type Funding, type RolloverMode } from "../domain/budget-line";
import type { LineDeps } from "./add-budget-line";
import { inSpaceCurrency, lineContext, lineOf, usableSavingsAccounts } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

/** HU-E6-03, HU-E6-04: what a PATCH changes; absent fields stay. */
export interface LineChanges {
  readonly name?: string;
  readonly plannedAmount?: Money;
  readonly funding?: Funding;
  readonly rolloverMode?: RolloverMode;
  readonly savingsAccountIds?: readonly string[];
  readonly isCatchAll?: boolean;
}

export type UpdateBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  lineId: string;
  expectedVersion: number | null;
  changes: LineChanges;
}) => Promise<Result<BudgetPlanView>>;

/**
 * HU-E6-03: edits a line; increasing it never pushes the plan above its capacity. HU-E6-04 SetCatchAllLine:
 * `isCatchAll` makes it the plan's one catch-all line. Its allocation rule stays (HU-E6-05).
 */
export const createUpdateBudgetLine =
  (deps: LineDeps): UpdateBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const line = lineOf(parts, input.lineId);
      if (!line.ok) return line;
      const { plannedAmount, ...rest } = input.changes;
      const planned = plannedAmount === undefined ? ok(undefined) : inSpaceCurrency(space, plannedAmount);
      if (!planned.ok) return planned;
      const revised = reviseLine(
        line.value,
        { ...rest, plannedAmount: planned.value },
        lineContext(parts, members, line.value.id),
      );
      if (!revised.ok) return revised;
      const accounts = await usableSavingsAccounts(
        deps.savingsAccounts,
        members,
        revised.value.savingsAccountIds,
        line.value.savingsAccountIds,
      );
      if (!accounts.ok) return accounts;
      await deps.lines.saveLine(revised.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
