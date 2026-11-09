import { useId } from "react";
import { useTranslations } from "next-intl";
import { CarryText } from "@/modules/budgeting/ui";
import { Badge, VisuallyHidden } from "@/shared/ui";
import type { LineDashboardDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { barWidth } from "./bar";

type Line = LineDashboardDto["lines"][number];

const isNegative = (money: { readonly amount: string }) => money.amount.startsWith("-");

/** #214: a line spent exactly as planned (above 90 % with nothing left) is done, not a warning. */
const onPlan = (line: Pick<Line, "state" | "available">) =>
  line.state === "HIGH" && line.available.amount === "0";

const TRACK = "block h-1.5 w-full overflow-hidden rounded-full bg-track";
// The owe ink for a negative figure: the plain owe color fails AA contrast below 18.66 px. Its sign says it too.
const FIGURE = "shrink-0 text-right font-semibold tabular-nums [overflow-wrap:anywhere]";
const tone = (value: { readonly amount: string }) => (isNegative(value) ? " text-owe-ink" : " text-ink");

/**
 * HU-E9-10 (the Lines artboard): the plan's totals as the API answers them (ruling P201), what was spent apart from
 * what was saved (#214, ruling P262), then the lines with Unbudgeted last.
 */
export function LineDashboard({
  dashboard,
  policy,
  formats,
  unbudgetedNames = [],
}: {
  readonly dashboard: LineDashboardDto;
  /** The space's period policy, which names the period a carry-over comes from (ruling P231 of M6c). */
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
  /** #240 (board E9-10 01): the categories Unbudgeted's spending fell into; none from an older API. */
  readonly unbudgetedNames?: readonly string[];
}) {
  const t = useTranslations("reports.lines");
  const summary = useId();
  const { totals } = dashboard;
  // #214 (ruling P262): the headline is what was spent, savings apart, as the API answers it; never a subtraction.
  const spending = totals.withoutSavings ?? totals;
  // #283 (ruling P313): the headline is what is left to spend, savings apart, as the API answers it.
  const left = spending.available ?? totals.available;
  const money = (value: MoneyDto) => formatMoney(value, formats);
  return (
    <>
      <section aria-labelledby={summary} className="flex flex-col gap-1 tabular-nums">
        <h2 id={summary} className="sr-only">
          {t("summary")}
        </h2>
        <p className="flex flex-col">
          <span className="text-sm text-muted">{t("totalAvailable")}</span>
          <span
            className={`text-3xl font-semibold${isNegative(left) ? " text-owe" : " text-ink"}`}
          >
            {money(left)}
          </span>
        </p>
        <p className="text-sm text-muted">
          {t("totalSpent", { spent: money(spending.spent), planned: money(spending.planned) })}
        </p>
        {totals.saved && dashboard.lines.some((line) => line.funding === "SAVINGS") ? (
          <p className="text-sm text-muted">{t("totalSaved", { saved: money(totals.saved) })}</p>
        ) : null}
      </section>
      <LineList
        dashboard={dashboard}
        policy={policy}
        formats={formats}
        unbudgetedCaption={(spent) =>
          unbudgetedNames.length > 0
            ? t("unbudgetedCaptionIn", { spent, categories: unbudgetedNames.join(", ") })
            : t("unbudgetedCaption", { spent })
        }
      />
    </>
  );
}

/**
 * Board E9-10 01 (ruling P272): one compact card of lines, each its name with what is still available at the right
 * (or "Cumplido" for a line spent as planned), its bar, and one caption with what was spent, or saved (#214), of what
 * was planned. A line near its limit wears no chip: its bar says it. The bars are CSS widths inside the items that
 * carry the figures, so the list and the bars are one element (ruling P202).
 */
export function LineList({
  dashboard,
  policy,
  formats,
  unbudgetedCaption,
}: {
  readonly dashboard: Pick<LineDashboardDto, "lines" | "unbudgeted" | "totals">;
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
  /** What Unbudgeted's caption says about its spent amount: where it went, or in which period without a plan. */
  readonly unbudgetedCaption: (spent: string) => string;
}) {
  const t = useTranslations("reports.lines");
  const base = useId();
  const { unbudgeted } = dashboard;
  const currency = dashboard.totals.planned.currency;
  const money = (value: MoneyDto) => formatMoney(value, formats);
  const available = (value: MoneyDto) => (
    <>
      <VisuallyHidden>{`${t("available")} `}</VisuallyHidden>
      {money(value)}
    </>
  );
  if (dashboard.lines.length === 0 && !unbudgeted) return null;
  return (
    <ul
      aria-label={t("caption")}
      className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface px-3.5"
    >
      {dashboard.lines.map((line) => {
        const nameId = `${base}-${line.lineId}`;
        const done = onPlan(line);
        const saves = line.funding === "SAVINGS";
        return (
          <li
            key={line.lineId}
            data-line={line.lineId}
            aria-labelledby={nameId}
            className="flex flex-col gap-1.5 py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span id={nameId} data-name className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">
                {line.name}
              </span>
              <span data-figure className={FIGURE + (done ? " text-ink" : tone(line.available))}>
                {done ? t("onPlan") : available(line.available)}
              </span>
            </div>
            {line.overspent || (line.state === "HIGH" && !done) ? (
              <span className="flex flex-wrap gap-2">
                {line.overspent ? (
                  <Badge tone="owe" icon="alert">
                    {t("overspent")}
                  </Badge>
                ) : null}
                {line.state === "HIGH" && !done ? <Badge tone="owe">{t("state.HIGH")}</Badge> : null}
              </span>
            ) : null}
            {line.state === "OVER" && line.overBy ? (
              <span className="text-sm text-owe-ink">{t("overBy", { amount: money(line.overBy) })}</span>
            ) : null}
            {line.carryOverFrom ? <CarryText line={line} policy={policy} formats={formats} /> : null}
            <span aria-hidden="true" className={TRACK}>
              <span
                data-bar
                className={`block h-full rounded-full ${line.overspent ? "bg-owe" : "bg-accent"}`}
                style={{ width: `${barWidth(line.spent, line.planned, line.carryOver)}%` }}
              />
            </span>
            <span data-caption className="text-sm text-muted tabular-nums">
              {t(saves ? "lineSaved" : "lineSpent", {
                spent: money(line.spent),
                planned: money(line.planned),
              })}
            </span>
          </li>
        );
      })}
      {unbudgeted ? (
        <li
          data-line="unbudgeted"
          aria-labelledby={`${base}-unbudgeted`}
          className="flex flex-col gap-1.5 py-3"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span
              id={`${base}-unbudgeted`}
              data-name
              className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]"
            >
              {t("unbudgeted")}
            </span>
            <span data-figure className={FIGURE + tone(unbudgeted.available)}>
              {available(unbudgeted.available)}
            </span>
          </div>
          <span aria-hidden="true" className={TRACK}>
            <span
              data-bar
              className="block h-full rounded-full bg-muted"
              style={{ width: `${barWidth(unbudgeted.spent, { amount: "0", currency })}%` }}
            />
          </span>
          <span data-caption className="text-sm text-muted tabular-nums">
            {unbudgetedCaption(money(unbudgeted.spent))}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
