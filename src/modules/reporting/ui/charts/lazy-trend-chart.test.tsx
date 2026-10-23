import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS, NBSP } from "@/shared/ui/format/formatters";
import { ChartFrame } from "./chart-frame";
import { LazyTrendChart } from "./lazy-trend-chart";
import { pointOf } from "./trend-series";

const periods = [
  "junio 2026",
  "julio 2026",
  "agosto 2026",
  "septiembre 2026",
  "octubre 2026",
  "noviembre 2026",
];
const data = {
  periods,
  series: [
    {
      key: "me",
      label: "Consumo",
      points: periods.map((_, i) => pointOf(cop(1_000_000 + i * 100_000), BUILT_IN_FORMATS)),
    },
  ],
};

// The first transform of the Recharts chunk is slow on a cold cache, as in CI: give it room.
describe("lazy trend chart (ruling P202, P220)", { timeout: 60_000 }, () => {
  it("shows a placeholder of the same size, then the chart from its own chunk, hidden from assistive tech", async () => {
    const { container } = renderWithIntl(
      <ChartFrame caption="Mi consumo por período">
        <LazyTrendChart data={data} />
      </ChartFrame>,
    );
    expect(screen.getByRole("figure", { name: "Mi consumo por período" })).toBeInTheDocument();
    expect(container.querySelector("[data-chart-placeholder]")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByTestId("trend-chart")).toBeNull();
    const chart = await screen.findByTestId("trend-chart", {}, { timeout: 45_000 });
    expect(chart).toHaveAttribute("data-points", "6");
    expect(chart).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[data-chart-placeholder]")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("leaves a gap for a missing period, writes the tooltip in the app's format and adds no keyboard stop", async () => {
    const gap = {
      periods: ["a", "b", "c"],
      series: [
        {
          key: "me",
          label: "Consumo",
          points: [
            pointOf(cop(1_300_000), BUILT_IN_FORMATS),
            pointOf(null, BUILT_IN_FORMATS),
            pointOf(cop(80_000), BUILT_IN_FORMATS),
          ],
        },
      ],
    };
    renderWithIntl(<LazyTrendChart data={gap} />);
    const chart = await screen.findByTestId("trend-chart", {}, { timeout: 45_000 });
    const curve = chart.querySelector("path.recharts-line-curve");
    expect(curve?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(curve).not.toHaveAttribute("stroke-dasharray");
    expect(chart.querySelector('svg[tabindex="0"], [role="application"]')).toBeNull();
    const wrapper = chart.querySelector(".recharts-wrapper");
    expect(wrapper).not.toBeNull();
    fireEvent.mouseMove(wrapper!, { clientX: 250, clientY: 100 });
    await waitFor(() =>
      expect(chart.querySelector(".recharts-tooltip-item-value")?.textContent).toBe(`$${NBSP}80.000`),
    );
  });

  it("gives each series its theme stroke, cycling after the third", async () => {
    const many = {
      periods: ["a", "b"],
      series: ["s1", "s2", "s3", "s4"].map((key, n) => ({
        key,
        label: key,
        points: [pointOf(cop(100 + n), BUILT_IN_FORMATS), pointOf(cop(200 + n), BUILT_IN_FORMATS)],
      })),
    };
    renderWithIntl(<LazyTrendChart data={many} />);
    const chart = await screen.findByTestId("trend-chart", {}, { timeout: 45_000 });
    const strokes = [...chart.querySelectorAll("path.recharts-line-curve")].map((path) =>
      path.getAttribute("stroke"),
    );
    expect(strokes).toEqual([
      "var(--color-accent)",
      "var(--color-owe)",
      "var(--color-muted)",
      "var(--color-accent)",
    ]);
  });

  it("follows the width of its frame when the browser reports one, and stops observing when it unmounts", async () => {
    const observers: { callback: ResizeObserverCallback; observed: boolean; disconnected: boolean }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly record: {
          callback: ResizeObserverCallback;
          observed: boolean;
          disconnected: boolean;
        };
        constructor(callback: ResizeObserverCallback) {
          this.record = { callback, observed: false, disconnected: false };
          observers.push(this.record);
        }
        observe() {
          this.record.observed = true;
        }
        unobserve() {}
        disconnect() {
          this.record.disconnected = true;
        }
      },
    );
    try {
      const { unmount } = renderWithIntl(<LazyTrendChart data={data} />);
      const chart = await screen.findByTestId("trend-chart", {}, { timeout: 45_000 });
      expect(chart.querySelector(".recharts-wrapper")).toHaveAttribute("width", "320");
      expect(observers[0]?.observed).toBe(true);
      act(() => {
        observers[0]?.callback(
          [{ contentRect: { width: 512.6 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      });
      expect(chart.querySelector(".recharts-wrapper")).toHaveAttribute("width", "512");
      unmount();
      expect(observers[0]?.disconnected).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
