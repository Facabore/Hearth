import { can, requirePermission, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import { reviseLine, type Funding, type PayersScope, type RolloverMode } from "../domain/budget-line";
import type { LineDeps } from "./add-budget-line";
import { inSpaceCurrency, lineContext, lineOf, usableSavingsAccounts } from "./line-checks";
import { managePlan, planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";

/** HU-E6-03, HU-E6-04: what a PATCH changes; absent fields stay. */
export interface LineChanges {
  readonly name?: string;
  readonly plannedAmount?: Money;
  readonly funding?: Funding;
  readonly rolloverMode?: RolloverMode;
  readonly savingsAccountIds?: readonly string[];
  readonly isCatchAll?: boolean;
  /** D26: the line's whole set of payers; empty clears them and their scope. */
  readonly payerMemberIds?: readonly string[];
  readonly payersScope?: PayersScope;
}

/** D26: the fields a payer of a line may change on it. */
const PAYER_FIELDS: readonly string[] = ["payerMemberIds", "payersScope"];
const onlyPayers = (changes: LineChanges): boolean =>
  Object.entries(changes).every(([field, value]) => value === undefined || PAYER_FIELDS.includes(field));

/**
 * D26: OWNER and ADMIN edit any line (plan.manage). A change of nothing but the payers and their scope is also let
 * through to whoever records money, and the use case then requires the caller to be a current payer of the line.
 */
const lineEditor =
  (changes: LineChanges) =>
  (membership: SpaceMembership): Result<SpaceMembership> => {
    const manager = managePlan(membership);
    return manager.ok || !onlyPayers(changes) ? manager : requirePermission(membership, "money.record");
  };

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
 * `isCatchAll` makes it the plan's one catch-all line. Its allocation rule stays (HU-E6-05). D26: a current payer of the
 * line who does not manage the plan changes only that line's payers and scope.
 */
export const createUpdateBudgetLine =
  (deps: LineDeps): UpdateBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input, lineEditor(input.changes));
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const line = lineOf(parts, input.lineId);
      if (!line.ok) return line;
      if (!can(space.role, "plan.manage") && !line.value.payerMemberIds.includes(space.memberId)) {
        return err(domainError("InsufficientRole"));
      }
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
        { callerUserId: space.userId, spaceCurrency: space.currency },
        revised.value.savingsAccountIds,
        line.value.savingsAccountIds,
      );
      if (!accounts.ok) return accounts;
      await deps.lines.saveLine(revised.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
