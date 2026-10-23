"use client";

import { useEffect, useState, type ComponentType } from "react";
import type { TrendChartProps } from "./trend-chart-props";

let loaded: ComponentType<TrendChartProps> | undefined;
let loading: Promise<void> | undefined;

/** Ruling P202: the Recharts chunk, fetched once and only by a page that draws a chart (M6a's lazy Sheet pattern). */
export const preloadTrendChart = (): Promise<void> =>
  (loading ??= import("./trend-chart").then((module) => {
    loaded = module.TrendChart;
  }));

export function LazyTrendChart(props: TrendChartProps) {
  const [Chart, setChart] = useState<ComponentType<TrendChartProps> | undefined>(() => loaded);
  useEffect(() => {
    if (!Chart) void preloadTrendChart().then(() => setChart(() => loaded));
  }, [Chart]);
  return Chart ? (
    <Chart {...props} />
  ) : (
    <div aria-hidden="true" data-chart-placeholder className="size-full rounded-xl bg-track" />
  );
}
