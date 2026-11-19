import type { PlanLineDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats } from "@/shared/ui/format/formatters";

/** Ruling P342 (S7): one budget of a line as its field holds it, the amount in the person's format. */
export interface BudgetRow {
  readonly currency: string;
  readonly text: string;
}

/**
 * Ruling P342 (S7, "Líneas por moneda"): a line's budgets as their fields start, one per currency in the line's order,
 * when it budgets another currency than the space's; null when its one budget is the space currency's (or an older API
 * answers no `budgets`), which the one "Planeado" field holds as before.
 */
export const budgetRowsOf = (
  line: PlanLineDto | null,
  formats: Pick<Formats, "numberFormat">,
): BudgetRow[] | null => {
  if (line === null) return null;
  const budgets = (line.budgets ?? []).filter((budget) => budget.budgeted);
  if (!budgets.some((budget) => budget.planned.currency !== line.plannedAmount.currency)) return null;
  return budgets.map(({ planned }) => ({
    currency: planned.currency,
    text: formatNumber(decimalOf(planned.amount, currencyOf(planned.currency).exponent), formats),
  }));
};
