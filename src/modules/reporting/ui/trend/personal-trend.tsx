import { useTranslations } from "next-intl";
import type { PersonalTrendDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { ChartFrame } from "../charts/chart-frame";
import { LazyTrendChart } from "../charts/lazy-trend-chart";
import { pointOf } from "../charts/trend-point";
import { changeFigure } from "./change-text";
import { useShortPeriod } from "./short-period";
import { TrendWindow } from "./trend-window";

/**
 * HU-E9-11 (the PersonalTrend artboard, board E9-11 03 under ruling P272): the caller's consumption over the window,
 * as a line chart in a card that names its point on touch, and a table of the same figures in a card, newest first
 * by their short names, the current period in bold (ruling P220: the table is the accessible source). Every figure is
 * the API's (ruling P201); the chart is the page's only client island, loaded after mount (ruling P202).
 */
export function PersonalTrend({
  space,
  trend,
  formats,
  periods,
}: {
  readonly space: SpaceDto;
  readonly trend: PersonalTrendDto;
  readonly formats: Pick<Formats, "numberFormat" | "dateFormat">;
  readonly periods: 6 | 12;
}) {
  const t = useTranslations("reports");
  const short = useShortPeriod();
  const names = trend.periods.map((p) => short(p, space.periodPolicy, formats));
  const end = trend.periods.at(-1)?.label;
  const rows = trend.points
    .map((point, index) => ({
      point,
      name: names[index]?.name ?? point.period,
      current: index === names.length - 1,
    }))
    .reverse();
  return (
    <section className="flex flex-col gap-3">
      <TrendWindow space={space} end={end} periods={periods} />
      <ChartFrame caption={t("trend.personalCaption")} hint={t("trend.hint")}>
        <LazyTrendChart
          data={{
            periods: names.map((name) => name.name),
            ticks: names.map((name) => name.month),
            series: [
              {
                key: "me",
                label: t("unified.consumption"),
                points: trend.points.map((p) => pointOf(p.consumption, formats)),
              },
            ],
          }}
        />
      </ChartFrame>
      <div data-table-card className="rounded-2xl border border-line bg-surface px-3.5 py-1">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("trend.personalTable")}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2 text-left font-normal text-muted">
                {t("trend.period")}
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-normal text-muted">
                {t("trend.consumption")}
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-normal text-muted">
                {t("trend.change")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ point, name, current }) => (
              <tr
                key={point.period}
                className={`border-b border-line last:border-b-0${current ? " font-semibold" : ""}`}
              >
                <th scope="row" className="py-2.5 text-left font-[inherit] whitespace-nowrap text-ink">
                  {name}
                </th>
                <td className="py-2.5 pl-3 text-right whitespace-nowrap text-ink tabular-nums">
                  {formatMoney(point.consumption, formats)}
                </td>
                <td className="py-2.5 pl-3 text-right text-ink tabular-nums">
                  {point.changeStatus === "NEW" ? (
                    <span className="text-muted">{t("trend.noPrevious")}</span>
                  ) : point.changeStatus ? (
                    changeFigure(point.change, point.changePercent, formats)
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
