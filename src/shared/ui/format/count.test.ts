import { describe, expect, it } from "vitest";
import { formatCount } from "./count";
import { formatNumber, type NumberFormat } from "./formatters";

describe("formatCount (P297)", () => {
  const formats: NumberFormat[] = ["DOT_COMMA", "COMMA_DOT", "SPACE_COMMA"];

  it.each(formats)("writes a whole count exactly as formatNumber does in %s", (numberFormat) => {
    for (const count of [0, 7, 999, 1204, 1_234_567]) {
      expect(formatCount(count, { numberFormat })).toBe(formatNumber(String(count), { numberFormat }));
    }
  });

  it("groups 1204 with the person's separator", () => {
    expect(formatCount(1204, { numberFormat: "DOT_COMMA" })).toBe("1.204");
    expect(formatCount(1204, { numberFormat: "COMMA_DOT" })).toBe("1,204");
    expect(formatCount(1204, { numberFormat: "SPACE_COMMA" })).toBe("1 204");
  });
});
