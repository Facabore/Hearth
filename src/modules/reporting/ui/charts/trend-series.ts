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
  /** Each period's name, as the tooltip writes it ("nov 2026"). */
  readonly periods: readonly string[];
  /** Board E9-11 03 (ruling P272): each period's short label under the axis ("nov"); the names when absent. */
  readonly ticks?: readonly string[];
  readonly series: readonly TrendSeries[];
}

export const chartRows = (data: TrendChartData): Record<string, string | number | null>[] =>
  data.periods.map((period, index) => ({
    period,
    tick: data.ticks?.[index] ?? period,
    ...Object.fromEntries(data.series.map((series) => [series.key, series.points[index]?.value ?? null])),
  }));

export const textAt = (data: TrendChartData, seriesKey: string, period: string): string | null =>
  data.series.find((s) => s.key === seriesKey)?.points[data.periods.indexOf(period)]?.text ?? null;
