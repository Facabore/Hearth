import type { MoneyDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";

/** A chart coordinate (major units, for plotting only) and the figure as the app writes it (for the tooltip). */
export interface TrendPoint {
  readonly value: number | null;
  readonly text: string | null;
}
export interface TrendSeries {
  readonly key: string;
  readonly label: string;
  readonly points: readonly TrendPoint[];
}
export interface TrendChartData {
  readonly periods: readonly string[];
  readonly series: readonly TrendSeries[];
}

/** Ruling P202: `Number` only positions a point; every figure shown is the API's string through `formatMoney`. */
export const pointOf = (money: MoneyDto | null, formats: Pick<Formats, "numberFormat">): TrendPoint =>
  money === null
    ? { value: null, text: null }
    : {
        value: Number(money.amount) / 10 ** currencyOf(money.currency).exponent,
        text: formatMoney(money, formats),
      };

export const chartRows = (data: TrendChartData): Record<string, string | number | null>[] =>
  data.periods.map((period, index) => ({
    period,
    ...Object.fromEntries(data.series.map((series) => [series.key, series.points[index]?.value ?? null])),
  }));

export const textAt = (data: TrendChartData, seriesKey: string, period: string): string | null =>
  data.series.find((s) => s.key === seriesKey)?.points[data.periods.indexOf(period)]?.text ?? null;
