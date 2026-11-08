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
const spentShare = ({ spent, planned }: LineDashboardDto["totals"]): number => {
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
 * Ruling P311 (board "Inicio personal · tu plan del mes"): on the personal Inicio, the shown period's plan as one link
 * to its Plan screen: "Tu plan de {mes}", what is left of what was planned (the API's totals, P201), or how much the
 * spending went past it ("Te pasaste $ X de $ Y planeados", in words, never a minus sign), a bar of what was spent,
 * and the line that went over the most, in words (never color alone). A period without a plan or without lines shows
 * nothing: the first steps propose the plan.
 */
export function PlanCard({
  dashboard,
  policy,
  formats,
  href,
}: {
  readonly dashboard: LineDashboardDto;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
  /** The personal Plan screen of this period. */
  readonly href: string;
}) {
  const t = useTranslations("home.plan");
  const common = useTranslations("common");
  if (dashboard.plan === null || dashboard.lines.length === 0) return null;
  const { totals } = dashboard;
  const money = (amount: MoneyDto) => formatMoney(amount, formats);
  const name = periodName(dashboard.period, policy);
  const over = overOf(dashboard.lines);
  const overText = over
    ? t(over.others > 0 ? "overMore" : "over", {
        line: over.line.name,
        amount: money(over.line.overBy),
        count: over.others,
      })
    : null;
  return (
    <Link href={href} className="flex min-h-11 flex-col gap-2 rounded-2xl bg-surface p-3">
      <span className="flex items-center justify-between gap-3">
        <span className="font-semibold [overflow-wrap:anywhere] text-ink">
          {name.kind === "month"
            ? t("title", { month: common(`month.${name.month as 1}`) })
            : t("titleRange", { start: formatDate(name.start, formats), end: formatDate(name.end, formats) })}
        </span>
        <Icon name="chevronRight" size={18} className="shrink-0 text-muted" />
      </span>
      <span className="text-sm [overflow-wrap:anywhere] text-muted">
        {BigInt(totals.available.amount) < 0n
          ? t("overspent", {
              over: money({ ...totals.available, amount: totals.available.amount.replace(/^-/, "") }),
              planned: money(totals.planned),
            })
          : t("left", { available: money(totals.available), planned: money(totals.planned) })}
      </span>
      <span
        data-plan-bar
        aria-hidden="true"
        className="block h-1.5 w-full overflow-hidden rounded-full bg-track"
      >
        <span className="block h-full rounded-full bg-accent" style={{ width: `${spentShare(totals)}%` }} />
      </span>
      {overText ? <span className="text-sm [overflow-wrap:anywhere] text-owe-ink">{overText}</span> : null}
    </Link>
  );
}
