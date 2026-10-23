import type { TrendChartData } from "./trend-series";

/** A separate file because `charts-load-lazily` counts type-only imports too, so a page imports the props from here. */
export interface TrendChartProps {
  readonly data: TrendChartData;
}
