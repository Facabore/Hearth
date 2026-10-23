import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { BUILT_IN_FORMATS, NBSP } from "@/shared/ui/format/formatters";
import { chartRows, pointOf, textAt } from "./trend-series";

describe("trend series (ruling P202)", () => {
  it("plots major units and keeps each point's text from the app's formatter", () => {
    expect(pointOf(cop(1_300_000), BUILT_IN_FORMATS)).toEqual({
      value: 1_300_000,
      text: `$${NBSP}1.300.000`,
    });
    expect(pointOf(null, BUILT_IN_FORMATS)).toEqual({ value: null, text: null });
  });

  it("builds one row per period with one value per series, and finds a point's text", () => {
    const data = {
      periods: ["octubre 2026", "noviembre 2026"],
      series: [
        {
          key: "l-home",
          label: "Home",
          points: [pointOf(cop(1_350_000), BUILT_IN_FORMATS), pointOf(cop(1_300_000), BUILT_IN_FORMATS)],
        },
        {
          key: "l-pets",
          label: "Pets",
          points: [pointOf(null, BUILT_IN_FORMATS), pointOf(cop(80_000), BUILT_IN_FORMATS)],
        },
      ],
    };
    expect(chartRows(data)).toEqual([
      { period: "octubre 2026", "l-home": 1_350_000, "l-pets": null },
      { period: "noviembre 2026", "l-home": 1_300_000, "l-pets": 80_000 },
    ]);
    expect(textAt(data, "l-pets", "noviembre 2026")).toBe(`$${NBSP}80.000`);
    expect(textAt(data, "l-pets", "octubre 2026")).toBeNull();
  });
});
