import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { TrendChart } from "./trend-chart";
import { pointOf } from "./trend-series";

const data = {
  periods: ["a", "b", "c"],
  series: ["s1", "s2", "s3", "s4"].map((key, n) => ({
    key,
    label: key,
    points: [1, 2, 3].map((v) => pointOf(cop(100_000 * v + n), BUILT_IN_FORMATS)),
  })),
};

// The first transform of Recharts is slow on a cold cache, as in CI: give it room.
describe("trend chart (issue #192)", { timeout: 60_000 }, () => {
  it("mounts in steps behind the placeholder and shows the chart only once it is whole", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWithIntl(<TrendChart data={data} />);
      let steps = 0;
      while (!screen.queryByTestId("trend-chart") && steps < 20) {
        expect(container.querySelector("[data-chart-placeholder]")).toHaveAttribute("aria-hidden", "true");
        expect(container.querySelector(".recharts-wrapper")).toHaveClass("invisible");
        steps += 1;
        act(() => vi.runOnlyPendingTimers());
      }
      expect(steps).toBeGreaterThan(1);
      const chart = screen.getByTestId("trend-chart");
      expect(container.querySelector("[data-chart-placeholder]")).toBeNull();
      expect(chart.querySelector(".recharts-wrapper")).not.toHaveClass("invisible");
      expect(chart.querySelectorAll("path.recharts-line-curve")).toHaveLength(4);
      expect(chart.querySelector(".recharts-cartesian-grid")).not.toBeNull();
      expect(chart.querySelector(".recharts-xAxis")).not.toBeNull();
      expect(chart.querySelector(".recharts-tooltip-wrapper")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
