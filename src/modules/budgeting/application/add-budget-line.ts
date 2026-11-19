import { ok, type Money, type Result } from "@/shared/kernel";
import { newLine, type Funding, type PayersScope, type RolloverMode } from "../domain/budget-line";
import type { BudgetingDeps } from "./deps";
import { budgetsOf, lineContext, usableSavingsAccounts } from "./line-checks";
import { planForWrite } from "./plan-access";
import { loadPlanView, type BudgetPlanView } from "./plan-view";
import type { BudgetLineRepository } from "./ports";

/** HU-E6-03: a new line; DIRECT and RESET unless given. */
export interface LineInput {
  readonly name: string;
  /** Ruling P342 (S7, "Líneas por moneda"): one positive budget per currency, in the order the line lists them. */
  readonly budgets: readonly Money[];
  readonly funding?: Funding;
  readonly rolloverMode?: RolloverMode;
  readonly savingsAccountIds?: readonly string[];
  readonly isCatchAll?: boolean;
  /** D26: who usually pays the line; nobody unless given. */
  readonly payerMemberIds?: readonly string[];
  /** D26: every period unless given, and only with payers. */
  readonly payersScope?: PayersScope;
}

export type AddBudgetLine = (input: {
  spaceId: string;
  userId: string;
  planId: string;
  expectedVersion: number | null;
  line: LineInput;
}) => Promise<Result<BudgetPlanView>>;

export type LineDeps = BudgetingDeps & { readonly lines: BudgetLineRepository };

/**
 * HU-E6-03: an OWNER or ADMIN adds a line whose positive planned amount fits the capacity not yet planned
 * (zero-based budgeting), with a funding source and a rollover mode; it starts PROPORTIONAL (HU-E6-05). Ruling P342
 * (S7): one budget per currency, each checked against the capacity in its own currency.
 */
export const createAddBudgetLine =
  (deps: LineDeps): AddBudgetLine =>
  (input) =>
    deps.tm.run(async () => {
      const write = await planForWrite(deps, input);
      if (!write.ok) return write;
      const { space, plan, members, parts } = write.value;
      const line = newLine(
        {
          id: deps.ids.next<"BudgetLine">(),
          planId: plan.id,
          now: deps.clock.now(),
          fields: {
            name: input.line.name,
            budgets: budgetsOf(input.line.budgets),
            funding: input.line.funding ?? "DIRECT",
            savingsAccountIds: input.line.savingsAccountIds ?? [],
            rolloverMode: input.line.rolloverMode ?? "RESET",
            isCatchAll: input.line.isCatchAll ?? false,
            payerMemberIds: input.line.payerMemberIds ?? [],
            payersScope: input.line.payersScope ?? null,
          },
        },
        lineContext(parts, members, null),
      );
      if (!line.ok) return line;
      const accounts = await usableSavingsAccounts(
        deps.savingsAccounts,
        { callerUserId: space.userId, spaceCurrency: space.currency },
        line.value.savingsAccountIds,
      );
      if (!accounts.ok) return accounts;
      await deps.lines.addLine(line.value, deps.clock.now());
      return ok(await loadPlanView(deps, space, plan));
    });
