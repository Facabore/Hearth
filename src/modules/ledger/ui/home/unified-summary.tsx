import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { MoneyDto, PeriodDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";
import type { UnifiedMonth } from "./feed";

/**
 * Ruling P324 (boards "Inicio personal" and "Inicio de Hogar", medium density): Inicio's one hero, on the page with no
 * card around it. A muted caption that names the period ("Gastaste en noviembre", or "Hogar gastó en noviembre" in a
 * shared space), the figure, and one muted line under it. The figure scales down on a phone and may wrap, so it never
 * widens the page at 320 px.
 */
export function Hero({
  period,
  policy,
  formats,
  space,
  amount,
  children,
}: {
  readonly period: PeriodDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "dateFormat">;
  /** A shared or direct space's name: its caption says that the space spent it. */
  readonly space?: string | undefined;
  readonly amount: string;
  /** The one line under the figure. */
  readonly children?: ReactNode;
}) {
  const t = useTranslations("home");
  const common = useTranslations("common");
  const name = periodName(period, policy);
  const month = name.kind === "month" ? common(`month.${name.month as 1}`) : "";
  const range =
    name.kind === "month"
      ? null
      : { start: formatDate(name.start, formats), end: formatDate(name.end, formats) };
  const caption =
    space === undefined
      ? range
        ? t("spentBetween", range)
        : t("spentIn", { month })
      : range
        ? t("spaceSpentBetween", { space, ...range })
        : t("spaceSpentIn", { space, month });
  return (
    <section aria-label={t("summary")} data-hero className="flex min-w-0 flex-col gap-1 pt-1">
      <p className="text-[15px] [overflow-wrap:anywhere] text-muted">{caption}</p>
      <p
        data-hero-amount
        className="text-[clamp(1.75rem,9.25vw,2.25rem)] leading-tight font-semibold [overflow-wrap:anywhere] text-ink"
      >
        {amount}
      </p>
      {children}
    </section>
  );
}

/**
 * Ruling P324 (amends P306's open parts): the personal Inicio's hero for someone with other spaces. One figure, what her
 * month cost her, and one line that says what it holds: "Incluye tu parte en Hogar. Solo tú $ X · con otros $ Y". That
 * line opens Mi consumo (#287), which explains why her month is not what she paid. What she paid for others lives in
 * the action line under it. It draws in the first paint, so it never moves what is under it.
 */
export function UnifiedSummary({
  unified,
  page,
  policy,
  formats,
  consumptionHref,
}: {
  readonly unified: UnifiedMonth;
  readonly page: TransactionPageDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Formats;
  /** #287 (audit pass 3, A7): Mi consumo of this period, which says why the month is not what was paid. */
  readonly consumptionHref?: string | undefined;
}) {
  const t = useTranslations("home");
  const money = (amount: MoneyDto) => formatMoney(amount, formats);
  const others = unified.withOthers.items;
  const [first] = others;
  const sub = first
    ? `${t("includes", { count: others.length, space: first.name })} ${t("parts", {
        solo: money(unified.solo.amount),
        others: money(unified.withOthers.amount),
      })}`
    : t("income", { amount: money(page.totals.income) });
  return (
    <Hero period={page.period} policy={policy} formats={formats} amount={money(unified.consumed)}>
      {first && consumptionHref ? (
        <Link
          href={consumptionHref}
          className="flex min-h-11 items-center text-sm [overflow-wrap:anywhere] text-muted"
        >
          {sub}
        </Link>
      ) : (
        <p className="text-sm [overflow-wrap:anywhere] text-muted">{sub}</p>
      )}
    </Hero>
  );
}
