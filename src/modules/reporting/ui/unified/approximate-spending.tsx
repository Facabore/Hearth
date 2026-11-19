import { useTranslations } from "next-intl";
import type { UnifiedViewDto } from "@/shared/ui/api/dto";
import { AmountText } from "@/shared/ui/atoms/amount";
import { formatApproximateMoney } from "@/shared/ui/format/approximate";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";

type Spending = NonNullable<UnifiedViewDto["spending"]>;

/**
 * Ruling P342 (S6, board "Inicio · total aproximado"): Inicio's figure when the month holds several currencies, the
 * API's sum at today's rate written "≈ 1.660.000 COP" in one unbreakable run; null when the month is in one currency
 * (or an older API sent no spending), so the figure stays as it was.
 */
export const approximateFigureOf = (
  view: Pick<UnifiedViewDto, "currency" | "spending">,
  formats: Formats,
): string | null =>
  view.spending?.approximate ? formatApproximateMoney(view.spending.approximate.total, formats) : null;

/**
 * Ruling P342 (S6): the line under Inicio's "≈" figure, what it adds up, each currency as it was spent, and at what
 * rate: "1.240.000 COP · 80 USD · 25 EUR. En pesos, a la tasa de hoy." A currency with no rate today is not in the
 * figure, and a second line says so ("Sin tasa hoy: 1.000 ARS.").
 */
export function ApproximateSpending({
  currency,
  spending,
  formats,
}: {
  /** The view's currency, the figure's. */
  readonly currency: string;
  readonly spending: Spending;
  readonly formats: Formats;
}) {
  const t = useTranslations("home.approximate");
  const list = (amounts: Spending["byCurrency"]) => amounts.map((m) => formatMoney(m, formats)).join(" · ");
  const unrated = spending.approximate?.unrated ?? [];
  return (
    <>
      {/* Ruling P335: the line's words wrap, its amounts stay whole. */}
      <span className="block text-sm text-muted">
        <AmountText text={t("line", { amounts: list(spending.byCurrency), currency })} />
      </span>
      {unrated.length > 0 ? (
        <span className="block text-sm text-muted">
          <AmountText text={t("unrated", { amounts: list(unrated) })} />
        </span>
      ) : null}
    </>
  );
}
