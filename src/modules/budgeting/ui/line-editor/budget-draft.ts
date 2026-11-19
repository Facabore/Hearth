import type { BudgetPlanDto, MoneyDto, PlanLineDto } from "@/shared/ui/api/dto";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats, type NumberFormat } from "@/shared/ui/format/formatters";

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

/** The budgets a save sends; the first row that cannot be read fails with its currency. */
export const budgetsOf = (
  rows: readonly BudgetRow[],
  numberFormat: NumberFormat,
): { ok: true; budgets: MoneyDto[] } | { ok: false; currency: string } => {
  const budgets: MoneyDto[] = [];
  for (const { currency, text } of rows) {
    const decimal = parseDecimal(text, numberFormat);
    const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
    if (minor === null) return { ok: false, currency };
    budgets.push({ amount: minor, currency });
  }
  return { ok: true, budgets };
};

/**
 * A refused PlanExceedsCapacity names no currency (P342): it is the first budget whose growth over what the line had
 * in its currency passes what is left to assign there ("Por repartir"); null when none does.
 */
export const exceededCurrency = (
  budgets: readonly MoneyDto[],
  plan: Pick<BudgetPlanDto, "currencies" | "unallocated">,
  line: PlanLineDto | null,
): string | null => {
  const left = (currency: string): bigint => {
    const own = (plan.currencies ?? []).find((c) => c.unallocated.currency === currency)?.unallocated;
    return BigInt(own?.amount ?? (plan.unallocated.currency === currency ? plan.unallocated.amount : "0"));
  };
  const had = (currency: string): bigint =>
    BigInt(
      (line?.budgets ?? []).find((budget) => budget.budgeted && budget.planned.currency === currency)?.planned
        .amount ??
        (line?.plannedAmount.currency === currency && !line.budgets ? line.plannedAmount.amount : "0"),
    );
  return (
    budgets.find((budget) => left(budget.currency) - (BigInt(budget.amount) - had(budget.currency)) < 0n)
      ?.currency ?? null
  );
};
