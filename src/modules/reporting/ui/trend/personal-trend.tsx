import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePeriodText } from "@/shared/ui";
import type { PersonalTrendDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { ChartFrame } from "../charts/chart-frame";
import { LazyTrendChart } from "../charts/lazy-trend-chart";
import { pointOf } from "../charts/trend-series";
import { viewHref } from "../views";
import { ChangeText } from "./change-text";

const WINDOWS = [6, 12] as const;

/**
 * HU-E9-11 (the PersonalTrend artboard): the caller's consumption over the window, as a line chart and a table of the
 * same figures, newest first (ruling P220: the table is the accessible source). Every figure is the API's (ruling
 * P201); the chart is the page's only client island, loaded after mount (ruling P202).
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
  const label = usePeriodText();
  const names = trend.periods.map((p) => label(p, space.periodPolicy, formats));
  const end = trend.periods.at(-1)?.label;
  const rows = trend.points.map((point, index) => ({ point, name: names[index] ?? point.period })).reverse();
  return (
    <section className="flex flex-col gap-4">
      <div className="flex gap-2">
        {WINDOWS.map((count) => (
          <Link
            key={count}
            href={`${viewHref(space, "trend", end)}${end ? "&" : "?"}periods=${count}`}
            aria-current={count === periods ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-full px-4 text-sm font-medium ${
              count === periods ? "bg-accent-soft text-accent" : "border border-line bg-surface text-ink"
            }`}
          >
            {t("trend.window", { count })}
          </Link>
        ))}
      </div>
      <ChartFrame caption={t("trend.personalCaption")}>
        <LazyTrendChart
          data={{
            periods: names,
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
      <table className="w-full text-sm">
        <caption className="pb-1 text-left text-sm font-medium text-ink">{t("trend.personalTable")}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 text-left font-medium text-muted">
              {t("trend.period")}
            </th>
            <th scope="col" className="py-2 pl-3 text-right font-medium text-muted">
              {t("trend.consumption")}
            </th>
            <th scope="col" className="py-2 pl-3 text-left font-medium text-muted">
              {t("trend.change")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ point, name }) => (
            <tr key={point.period} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 text-left font-normal text-ink">
                {name}
              </th>
              <td className="py-2 pl-3 text-right text-ink tabular-nums">
                {formatMoney(point.consumption, formats)}
              </td>
              <td className="py-2 pl-3 text-ink">
                <ChangeText
                  change={point.change}
                  changePercent={point.changePercent}
                  changeStatus={point.changeStatus}
                  formats={formats}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
