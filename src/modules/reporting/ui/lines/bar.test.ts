import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { barWidth } from "./bar";

describe("bar widths (ruling P202: presentation, never a figure)", () => {
  it("fills a line by what it spent of its plan, capped at the full bar", () => {
    expect(barWidth(cop(1_300_000), cop(1_470_000))).toBe(88);
    expect(barWidth(cop(1_600_000), cop(1_470_000))).toBe(100);
    expect(barWidth(cop(0), cop(600_000))).toBe(0);
    expect(barWidth(cop(60_000), cop(0))).toBe(100);
    expect(barWidth(cop(0), cop(0))).toBe(0);
  });

  it("measures a line against planned plus what it carried in (ruling P231 of M6c)", () => {
    expect(barWidth(cop(1_300_000), cop(1_470_000), cop(200_000))).toBe(77);
    expect(barWidth(cop(250_000), cop(730_000), cop(-130_000))).toBe(41);
    expect(barWidth(cop(100), cop(100), cop(-100))).toBe(100);
    expect(barWidth(cop(1_300_000), cop(1_470_000))).toBe(88);
  });
});
