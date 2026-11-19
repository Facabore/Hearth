import type { BudgetPlanDto, MoneyDto, PlanLineDto } from "@/shared/ui/api/dto";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import type { BudgetRow } from "./budget-draft";

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
