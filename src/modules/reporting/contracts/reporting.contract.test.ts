import { describe, expect, it } from "vitest";
import { changeFrom } from "../domain/trend";
import { changeDto, LineTrendSchema, signedPercent, TrendQuerySchema } from "./reporting.contract";

describe("signedPercent (HU-E7-05, ruling P38)", () => {
  it("signs a decrease and keeps exactly two decimals", () => {
    expect(signedPercent(-370)).toBe("-3.70");
    expect(signedPercent(-1)).toBe("-0.01");
    expect(signedPercent(-99)).toBe("-0.99");
    expect(signedPercent(-100)).toBe("-1.00");
    expect(signedPercent(-12_345)).toBe("-123.45");
  });

  it("writes an increase without a sign", () => {
    expect(signedPercent(1250)).toBe("12.50");
    expect(signedPercent(5)).toBe("0.05");
    expect(signedPercent(10_000)).toBe("100.00");
    expect(signedPercent(1_234_567)).toBe("12345.67");
  });

  it("writes zero as 0.00, never -0.00", () => {
    expect(signedPercent(0)).toBe("0.00");
    expect(signedPercent(-0)).toBe("0.00");
  });

  it("answers null where there is no percentage", () => {
    expect(signedPercent(null)).toBeNull();
  });

  it("stays exact at the edge of the safe integers, on both signs", () => {
    expect(signedPercent(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(signedPercent(-Number.MAX_SAFE_INTEGER)).toBe("-90071992547409.91");
    expect(signedPercent(9_007_199_254_740_900)).toBe("90071992547409.00");
  });

  it("is null past 2^53 basis points (ruling P100) while the amount and status are still answered", () => {
    const change = changeFrom(1n, 10n ** 12n);
    expect(change.status).toBe("INCREASED");
    expect(change.amount).toBe(10n ** 12n - 1n);
    expect(Number.isSafeInteger(change.basisPoints)).toBe(false);
    expect(changeDto(change, "COP")).toEqual({
      change: { amount: String(10n ** 12n - 1n), currency: "COP" },
      changePercent: null,
    });
  });
});

describe("changeDto", () => {
  it("gives a NEW change neither an amount nor a percentage", () => {
    expect(changeDto({ amount: null, basisPoints: null, status: "NEW" }, "COP")).toEqual({
      change: null,
      changePercent: null,
    });
  });

  it("gives money through moneyOf and the signed percentage", () => {
    expect(changeDto({ amount: -5_000_000n, basisPoints: -370, status: "DECREASED" }, "COP")).toEqual({
      change: { amount: "-5000000", currency: "COP" },
      changePercent: "-3.70",
    });
    expect(changeDto({ amount: 0n, basisPoints: 0, status: "UNCHANGED" }, "COP")).toEqual({
      change: { amount: "0", currency: "COP" },
      changePercent: "0.00",
    });
  });

  it("answers nothing for a point without a change", () => {
    expect(changeDto(null, "COP")).toEqual({ change: null, changePercent: null });
  });
});

describe("TrendQuerySchema (ruling P38)", () => {
  const parse = (query: Record<string, unknown>) => TrendQuerySchema.safeParse(query);

  it("shows six periods by default", () => {
    expect(parse({ endPeriod: "2026-11" })).toMatchObject({
      success: true,
      data: { endPeriod: "2026-11", periods: 6 },
    });
  });

  it("takes 1 to 24 whole periods, as the query string spells them", () => {
    for (const periods of ["1", "6", "24", 24]) {
      expect(parse({ endPeriod: "2026-11", periods }).success).toBe(true);
    }
    expect(parse({ endPeriod: "2026-11", periods: "12" })).toMatchObject({ data: { periods: 12 } });
  });

  it("refuses 0, 25, fractions, negatives and words", () => {
    for (const periods of ["0", "25", "1.5", "-1", "six", "", "NaN", "Infinity"]) {
      expect(parse({ endPeriod: "2026-11", periods }).success).toBe(false);
    }
  });

  it("needs an end period of 1 to 32 characters", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ endPeriod: "" }).success).toBe(false);
    expect(parse({ endPeriod: "x".repeat(33) }).success).toBe(false);
    expect(parse({ endPeriod: "x".repeat(32) }).success).toBe(true);
  });
});

describe("LineTrendSchema.changePercent", () => {
  const point = (changePercent: string | null) => ({
    spaceId: "s",
    periods: [],
    plan: null,
    lines: [
      {
        lineId: "l",
        name: "Home",
        points: [{ period: "2026-11", spent: null, change: null, changePercent, changeStatus: null }],
      },
    ],
  });

  it("is a signed number with exactly two decimals, or null", () => {
    for (const ok of ["-3.70", "12.50", "0.00", "90071992547409.91", null]) {
      expect(LineTrendSchema.safeParse(point(ok)).success).toBe(true);
    }
    for (const bad of ["3.7", "3", "+3.70", "-.70", "NaN", "Infinity", "3.700", "", " 3.70"]) {
      expect(LineTrendSchema.safeParse(point(bad)).success).toBe(false);
    }
  });
});
