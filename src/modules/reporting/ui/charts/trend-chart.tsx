"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendChartProps } from "./trend-chart-props";
import { chartRows, textAt, type TrendChartData } from "./trend-series";

const HEIGHT = 224;
const STROKES = ["var(--color-accent)", "var(--color-owe)", "var(--color-muted)"] as const;

/**
 * Issue #192: the stages the chart mounts in, one task each. Recharts settles every part it is given in one blocking
 * pass (its layout effects feed its store, which re-renders synchronously), so the chart grows a part per task: the
 * empty chart, then the axes, then each series, the grid and last the tooltip. Until the last stage it stays hidden
 * behind the placeholder, so what is drawn never changes, only when.
 */
const stagesOf = (series: number): number => series + 4;

type TickProps = { x?: number | string; y?: number | string; payload?: { value?: unknown; index?: number } };

/** Board E9-11 03 (ruling P272): every period's short label under the axis, the current (last) one in bold. */
const tickOf =
  (last: number) =>
  ({ x, y, payload }: TickProps) => (
    <text
      x={Number(x)}
      y={Number(y) + 12}
      textAnchor="middle"
      fontSize={12}
      fontWeight={payload?.index === last ? 700 : 400}
      fill={payload?.index === last ? "var(--color-ink)" : "var(--color-muted)"}
    >
      {String(payload?.value ?? "")}
    </text>
  );

type TooltipContent = NonNullable<ComponentProps<typeof Tooltip>["content"]>;

/** Board E9-11 03: the point's period and its figure as the app writes it, in a dark box above the point. */
const tooltipOf =
  (data: TrendChartData): TooltipContent =>
  ({ active, payload }) => {
    const items = payload ?? [];
    const period = String(items[0]?.payload?.period ?? "");
    if (!active || items.length === 0) return null;
    return (
      <div data-tooltip className="rounded-lg bg-ink px-2.5 py-1.5 text-surface shadow-md">
        <p data-period className="text-xs opacity-80">
          {period}
        </p>
        {items.map((item) => (
          <p key={String(item.dataKey)} data-value className="text-sm font-semibold tabular-nums">
            {textAt(data, String(item.dataKey), period)}
          </p>
        ))}
      </div>
    );
  };

/**
 * The only importer of Recharts (ruling P202), reached through `LazyTrendChart`'s `import()`. The root is hidden from
 * assistive technology and Recharts' accessibility layer is off: the table next to the chart is the source (ruling P220).
 * It opens on the last period's value, with a dashed guide down to the axis (board E9-11 03).
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
  // The same rows, tick and tooltip on every stage, so a stage's pass never also hands Recharts new data to recompute.
  const rows = useMemo(() => chartRows(data), [data]);
  const tick = useMemo(() => tickOf(data.periods.length - 1), [data]);
  const content = useMemo(() => tooltipOf(data), [data]);
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
        margin={{ top: 48, right: 16, bottom: 4, left: 16 }}
        className={ready ? undefined : "invisible"}
      >
        {stage >= last - 1 && <CartesianGrid vertical={false} />}
        {stage >= 1 && (
          <XAxis dataKey="tick" tickLine={false} tick={tick} interval={data.ticks ? 0 : "preserveEnd"} />
        )}
        {stage >= 1 && <YAxis hide />}
        {ready && (
          <Tooltip
            content={content}
            cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }}
            defaultIndex={rows.length - 1}
            isAnimationActive={false}
          />
        )}
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
