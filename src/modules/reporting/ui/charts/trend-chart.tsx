"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendChartProps } from "./trend-chart-props";
import { chartRows, textAt } from "./trend-series";

const HEIGHT = 224;
const STROKES = ["var(--color-accent)", "var(--color-owe)", "var(--color-muted)"] as const;

/**
 * Issue #192: the stages the chart mounts in, one task each. Recharts settles every part it is given in one blocking
 * pass (its layout effects feed its store, which re-renders synchronously), so the chart grows a part per task: the
 * empty chart, then the axes, then each series, the grid and last the tooltip. Until the last stage it stays hidden
 * behind the placeholder, so what is drawn never changes, only when.
 */
const stagesOf = (series: number): number => series + 4;

/**
 * The only importer of Recharts (ruling P202), reached through `LazyTrendChart`'s `import()`. The root is hidden from
 * assistive technology and Recharts' accessibility layer is off: the table next to the chart is the source (ruling P220).
 */
export function TrendChart({ data }: TrendChartProps) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const last = stagesOf(data.series.length) - 1;
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= last) return;
    const timer = setTimeout(() => setStage((current) => current + 1), 0);
    return () => clearTimeout(timer);
  }, [stage, last]);
  const ready = stage >= last;
  // The same rows and formatter on every stage, so a stage's pass never also hands Recharts new data to recompute.
  const rows = useMemo(() => chartRows(data), [data]);
  const formatter = useMemo<ComponentProps<typeof Tooltip>["formatter"]>(
    () => (_value, _name, item) => textAt(data, String(item.dataKey), String(item.payload?.period)),
    [data],
  );
  return (
    <div
      ref={root}
      aria-hidden="true"
      {...(ready
        ? { "data-testid": "trend-chart", "data-points": data.periods.length }
        : { "data-chart-placeholder": "" })}
      className={ready ? "size-full" : "size-full rounded-xl bg-track"}
    >
      <LineChart
        width={width}
        height={HEIGHT}
        data={rows}
        accessibilityLayer={false}
        className={ready ? undefined : "invisible"}
      >
        {stage >= last - 1 && <CartesianGrid vertical={false} />}
        {stage >= 1 && <XAxis dataKey="period" tickLine={false} />}
        {stage >= 1 && <YAxis hide />}
        {ready && <Tooltip formatter={formatter} />}
        {data.series.slice(0, Math.max(0, stage - 1)).map((series, index) => (
          <Line
            key={series.key}
            dataKey={series.key}
            name={series.label}
            stroke={STROKES[index % STROKES.length]}
            isAnimationActive={false}
            dot
            connectNulls={false}
          />
        ))}
      </LineChart>
    </div>
  );
}
