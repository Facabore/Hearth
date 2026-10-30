import { useId } from "react";
import { useTranslations } from "next-intl";
import { CarryText } from "@/modules/budgeting/ui";
import { Badge } from "@/shared/ui";
import type { LineDashboardDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { barWidth } from "./bar";

const isNegative = (money: { readonly amount: string }) => money.amount.startsWith("-");

/** #214: a line spent exactly as planned (above 90 % with nothing left) is done, not a warning. */
const onPlan = (line: Pick<LineDashboardDto["lines"][number], "state" | "available">) =>
  line.state === "HIGH" && line.available.amount === "0";

// Under 640 px a row is a card (name, then one labelled figure per line), because three amounts side by side do
// not fit a phone; from 640 px it is a table row. The labels are CSS content, so a cell's text stays its figure.
const CELL =
  "flex justify-between gap-3 py-0.5 text-right tabular-nums before:text-left before:text-muted before:content-[attr(data-label)] sm:table-cell sm:py-3 sm:before:hidden";
const TRACK = "mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-track";
const NAME_CELL = "pb-1 text-left font-normal sm:table-cell sm:py-3 sm:pr-3";

/**
 * HU-E9-10 (the Lines artboard): the plan's totals as the API answers them (ruling P201), then one table of the
 * lines' planned, spent and available figures with Unbudgeted last. The bars are CSS widths inside the rows that
 * carry the figures, so the table and the bars are one element (ruling P202).
 */
export function LineDashboard({
  dashboard,
  policy,
  formats,
}: {
  readonly dashboard: LineDashboardDto;
  /** The space's period policy, which names the period a carry-over comes from (ruling P231 of M6c). */
  readonly policy: SpaceDto["periodPolicy"];
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
}) {
  const t = useTranslations("reports.lines");
  const summary = useId();
  const { totals, unbudgeted } = dashboard;
  const currency = totals.planned.currency;
  const money = (value: { readonly amount: string; readonly currency: string }) =>
    formatMoney(value, formats);
  // The owe ink for the table's small figures: the plain owe color fails AA contrast below 18.66 px.
  const tone = (value: { readonly amount: string }) => (isNegative(value) ? " text-owe-ink" : "");
  return (
    <>
      <section aria-labelledby={summary} className="flex flex-col gap-1 tabular-nums">
        <h2 id={summary} className="sr-only">
          {t("summary")}
        </h2>
        <p className="flex flex-col">
          <span className="text-sm text-muted">{t("totalAvailable")}</span>
          <span
            className={`text-3xl font-semibold${isNegative(totals.available) ? " text-owe" : " text-ink"}`}
          >
            {money(totals.available)}
          </span>
        </p>
        <p className="text-sm text-muted">
          {t("totalSpent", { spent: money(totals.spent), planned: money(totals.planned) })}
        </p>
      </section>
      <div className="rounded-2xl border border-line bg-surface px-3">
        <table className="block w-full text-sm sm:table">
          <caption className="sr-only">{t("caption")}</caption>
          <thead className="sr-only sm:not-sr-only sm:table-header-group">
            <tr className="sm:border-b sm:border-line">
              <th scope="col" className="py-2 text-left font-medium text-muted">
                {t("line")}
              </th>
              {(["planned", "spent", "available"] as const).map((column) => (
                <th key={column} scope="col" className="py-2 text-right font-medium text-muted">
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="block sm:table-row-group [&>tr:last-child]:border-b-0">
            {dashboard.lines.map((line) => (
              <tr
                key={line.lineId}
                data-line={line.lineId}
                className="flex flex-col border-b border-line py-3 sm:table-row sm:py-0"
              >
                <th scope="row" className={NAME_CELL}>
                  <span className="flex flex-wrap items-center gap-2 font-semibold text-ink [overflow-wrap:anywhere]">
                    {line.name}
                    {line.overspent ? (
                      <Badge tone="owe" icon="alert">
                        {t("overspent")}
                      </Badge>
                    ) : null}
                    {line.state === "NEAR" ? <Badge tone="neutral">{t("state.NEAR")}</Badge> : null}
                    {line.state === "HIGH" && onPlan(line) ? (
                      <Badge tone="accent" icon="check">
                        {t("onPlan")}
                      </Badge>
                    ) : null}
                    {line.state === "HIGH" && !onPlan(line) ? (
                      <Badge tone="owe">{t("state.HIGH")}</Badge>
                    ) : null}
                  </span>
                  {line.state === "OVER" && line.overBy ? (
                    <span className="mt-0.5 block text-sm font-normal text-owe-ink">
                      {t("overBy", { amount: money(line.overBy) })}
                    </span>
                  ) : null}
                  {line.carryOverFrom ? (
                    <span className="mt-0.5 block">
                      <CarryText line={line} policy={policy} formats={formats} />
                    </span>
                  ) : null}
                  <span aria-hidden="true" className={TRACK}>
                    <span
                      data-bar
                      className={`block h-full rounded-full ${line.overspent ? "bg-owe" : "bg-accent"}`}
                      style={{ width: `${barWidth(line.spent, line.planned, line.carryOver)}%` }}
                    />
                  </span>
                </th>
                <td data-label={t("planned")} className={CELL}>
                  {money(line.planned)}
                </td>
                {/* #214: what reaches a savings line is saved, not spent; on a wide screen the column says "Gastado". */}
                <td data-label={t(line.funding === "SAVINGS" ? "saved" : "spent")} className={CELL}>
                  {line.funding === "SAVINGS" ? (
                    <span className="hidden text-muted sm:inline">{`${t("saved")} `}</span>
                  ) : null}
                  {money(line.spent)}
                </td>
                <td data-label={t("available")} className={CELL + tone(line.available)}>
                  {money(line.available)}
                </td>
              </tr>
            ))}
            {unbudgeted ? (
              <tr data-line="unbudgeted" className="flex flex-col py-3 sm:table-row sm:py-0">
                <th scope="row" className={NAME_CELL}>
                  <span className="font-semibold text-ink [overflow-wrap:anywhere]">{t("unbudgeted")}</span>
                  <span aria-hidden="true" className={TRACK}>
                    <span
                      data-bar
                      className="block h-full rounded-full bg-muted"
                      style={{ width: `${barWidth(unbudgeted.spent, { amount: "0", currency })}%` }}
                    />
                  </span>
                </th>
                <td data-label={t("planned")} className={CELL}>
                  {money({ amount: "0", currency })}
                </td>
                <td data-label={t("spent")} className={CELL}>
                  {money(unbudgeted.spent)}
                </td>
                <td data-label={t("available")} className={CELL + tone(unbudgeted.available)}>
                  {money(unbudgeted.available)}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {unbudgeted ? <p className="text-sm text-muted">{t("unbudgetedNote")}</p> : null}
    </>
  );
}
