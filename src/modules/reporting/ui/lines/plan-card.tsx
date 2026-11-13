import Link from "next/link";
import { useTranslations } from "next-intl";
import { Icon } from "@/shared/ui";
import type { LineDashboardDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";

type Line = LineDashboardDto["lines"][number];

/**
 * How much of the bar the period's spending fills, 0–100, from the API's totals (bigint, minor units); presentation,
 * never shown as a figure. It is `barWidth`'s rule (P202) without a carry-over, kept here so Inicio and the Plan
 * screen share no chunk of script for 4 lines: that chunk's name alone pushed the shell over its budget (ADR 0004).
 */
const spentShare = ({ spent, planned }: { spent: MoneyDto; planned: MoneyDto }): number => {
  const used = BigInt(spent.amount);
  const plan = BigInt(planned.amount);
  if (plan <= 0n) return used > 0n ? 100 : 0;
  const share = (used * 100n) / plan;
  return Number(share > 100n ? 100n : share < 0n ? 0n : share);
};

/** The line that went over its budget the most (bigint, minor units), and how many others went over too. */
const overOf = (lines: readonly Line[]) => {
  const over = lines.filter((line): line is Line & { overBy: MoneyDto } => line.overBy !== null);
  const most = over.reduce<(typeof over)[number] | undefined>(
    (top, line) => (top === undefined || BigInt(line.overBy.amount) > BigInt(top.overBy.amount) ? line : top),
    undefined,
  );
  return most ? { line: most, others: over.length - 1 } : null;
};

/**
 * Ruling P311, as P324 draws it at medium density: the shown period's plan as one link to its Plan screen, never a card.
 * On the personal Inicio (`line`) it is the last line of the page: "Tu plan de {mes} · Te quedan $ X de $ Y", or how
 * much the spending went past it ("Te pasaste $ X de $ Y planeados", in words, never a minus sign), and the line that
 * went over the most, in words (never color alone). On a shared space's Inicio (`hero`) it is the line under the hero,
 * "de $ 4.000.000 del plan", with a thin bar of what was spent: the plan's entry point there. A period without a plan
 * or without lines shows nothing: the first steps propose the plan.
 */
export function PlanCard({
  dashboard,
  policy,
  formats,
  href,
  variant = "line",
}: {
  readonly dashboard: LineDashboardDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
  /** The Plan screen of this period. */
  readonly href: string;
  /** Ruling P324: the personal Inicio's last line, or the line under a shared Inicio's hero. */
  readonly variant?: "line" | "hero";
}) {
  const t = useTranslations("home.plan");
  const common = useTranslations("common");
  if (dashboard.plan === null || dashboard.lines.length === 0) return null;
  // #283 (ruling P313): what is left to spend of what was planned to spend, savings apart, as the API answers it; an
  // older API without those figures falls back to the totals.
  const { withoutSavings } = dashboard.totals;
  const totals = {
    planned: withoutSavings?.planned ?? dashboard.totals.planned,
    spent: withoutSavings?.spent ?? dashboard.totals.spent,
    available: withoutSavings?.available ?? dashboard.totals.available,
  };
  const money = (amount: MoneyDto) => formatMoney(amount, formats);
  const overspent = BigInt(totals.available.amount) < 0n;
  const overBy = money({ ...totals.available, amount: totals.available.amount.replace(/^-/, "") });
  const over = overOf(dashboard.lines);
  const overText = over
    ? t(over.others > 0 ? "overMore" : "over", {
        line: over.line.name,
        amount: money(over.line.overBy),
        count: over.others,
      })
    : null;
  if (variant === "hero")
    return (
      <Link href={href} className="flex min-h-11 flex-col justify-center gap-1.5 text-sm text-muted">
        <span className="[overflow-wrap:anywhere]">
          {overspent
            ? t("ofPlanOver", { over: overBy, planned: money(totals.planned) })
            : t("ofPlan", { planned: money(totals.planned) })}
        </span>
        <span
          data-plan-bar
          aria-hidden="true"
          className="block h-1.5 w-full overflow-hidden rounded-full bg-track"
        >
          <span className="block h-full rounded-full bg-accent" style={{ width: `${spentShare(totals)}%` }} />
        </span>
        {overText ? <span className="[overflow-wrap:anywhere] text-owe-ink">{overText}</span> : null}
      </Link>
    );
  const name = periodName(dashboard.period, policy);
  return (
    <Link href={href} className="flex min-h-11 items-center gap-2 py-1 text-sm">
      <Icon name="chart" size={18} className="shrink-0 text-accent" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="[overflow-wrap:anywhere]">
          <span className="font-medium text-accent">
            {name.kind === "month"
              ? t("title", { month: common(`month.${name.month as 1}`) })
              : t("titleRange", {
                  start: formatDate(name.start, formats),
                  end: formatDate(name.end, formats),
                })}
          </span>
          <span className="text-muted"> · </span>
          <span className="text-muted">
            {overspent
              ? t("overspent", { over: overBy, planned: money(totals.planned) })
              : t("left", { available: money(totals.available), planned: money(totals.planned) })}
          </span>
        </span>
        {overText ? <span className="[overflow-wrap:anywhere] text-owe-ink">{overText}</span> : null}
      </span>
      <Icon name="chevronRight" size={18} className="shrink-0 text-muted" />
    </Link>
  );
}
