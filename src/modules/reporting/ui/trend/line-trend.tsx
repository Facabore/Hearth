import { useId } from "react";
import { useTranslations } from "next-intl";
import { usePeriodText, VisuallyHidden } from "@/shared/ui";
import type { LineTrendDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { ChartFrame } from "../charts/chart-frame";
import { LazyTrendChart } from "../charts/lazy-trend-chart";
import { pointOf } from "../charts/trend-series";
import { ChangeText } from "./change-text";
import { TrendWindow } from "./trend-window";

/** A period where a line has no figure: a dash on screen, its name for a screen reader. */
function NoFigure({ text }: { readonly text: string }) {
  return (
    <>
      <span aria-hidden="true">—</span>
      <VisuallyHidden>{text}</VisuallyHidden>
    </>
  );
}

/**
 * HU-E9-11 (the LineTrend artboard): every line of the end period's plan over the window, as one chart series per line
 * and a table of the same figures (ruling P220: the table is the accessible source), with each line's end-period spent
 * and its change. Every figure is the API's (ruling P201); the chart is the page's only client island (ruling P202).
 */
export function LineTrend({
  space,
  trend,
  formats,
  periods,
}: {
  readonly space: SpaceDto;
  readonly trend: LineTrendDto;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
  readonly periods: 6 | 12;
}) {
  const t = useTranslations("reports");
  const label = usePeriodText();
  const ids = useId();
  if (trend.plan === null) return <p className="text-sm text-muted">{t("trend.noPlan")}</p>;
  const names = trend.periods.map((p) => label(p, space.periodPolicy, formats));
  const end = trend.periods.at(-1)?.label;
  const endName = names.at(-1) ?? end ?? "";
  return (
    <section className="flex flex-col gap-3">
      <TrendWindow space={space} end={end} periods={periods} />
      <ChartFrame caption={t("trend.linesCaption")}>
        <LazyTrendChart
          data={{
            periods: names,
            series: trend.lines.map((line) => ({
              key: line.lineId,
              label: line.name,
              points: line.points.map((p) => pointOf(p.spent, formats)),
            })),
          }}
        />
      </ChartFrame>
      <ul className="flex flex-col divide-y divide-line">
        {trend.lines.map((line) => {
          const last = line.points.at(-1);
          const nameId = `${ids}-${line.lineId}`;
          return (
            <li key={line.lineId} aria-labelledby={nameId} className="flex flex-col gap-1 py-3">
              <span id={nameId} className="font-medium text-ink">
                {line.name}
              </span>
              <span className="text-sm text-muted">
                {t("trend.spentIn", { period: endName })}{" "}
                <span className="text-ink tabular-nums">
                  {last?.spent ? formatMoney(last.spent, formats) : <NoFigure text={t("trend.noFigure")} />}
                </span>
              </span>
              {last ? (
                <span className="text-sm text-ink">
                  <ChangeText
                    change={last.change}
                    changePercent={last.changePercent}
                    changeStatus={last.changeStatus}
                    formats={formats}
                    increaseIsBad
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div role="region" aria-label={t("trend.linesTable")} tabIndex={0} className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption>
            <VisuallyHidden>{t("trend.linesTable")}</VisuallyHidden>
          </caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 text-left font-medium text-muted">
                {t("lines.line")}
              </th>
              {trend.periods.map((period, index) => (
                <th
                  key={period.label}
                  scope="col"
                  className="py-2 pl-3 text-right font-medium whitespace-nowrap text-muted"
                >
                  {names[index]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trend.lines.map((line) => (
              <tr key={line.lineId} className="border-b border-line last:border-b-0">
                <th scope="row" className="py-2 text-left font-normal text-ink">
                  {line.name}
                </th>
                {line.points.map((point) => (
                  <td
                    key={point.period}
                    className="py-2 pl-3 text-right whitespace-nowrap text-ink tabular-nums"
                  >
                    {point.spent ? (
                      formatMoney(point.spent, formats)
                    ) : (
                      <NoFigure text={t("trend.noFigure")} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">{t("trend.linesNote")}</p>
    </section>
  );
}
