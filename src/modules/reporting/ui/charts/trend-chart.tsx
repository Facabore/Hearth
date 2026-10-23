"use client";

import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendChartProps } from "./trend-chart-props";
import { chartRows, textAt } from "./trend-series";

const HEIGHT = 224;
const STROKES = ["var(--color-accent)", "var(--color-owe)", "var(--color-muted)"] as const;

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
  return (
    <div
      ref={root}
      aria-hidden="true"
      data-testid="trend-chart"
      data-points={data.periods.length}
      className="size-full"
    >
      <LineChart width={width} height={HEIGHT} data={chartRows(data)} accessibilityLayer={false}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period" tickLine={false} />
        <YAxis hide />
        <Tooltip
          formatter={(_value, _name, item) =>
            textAt(data, String(item.dataKey), String(item.payload?.period))
          }
        />
        {data.series.map((series, index) => (
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
