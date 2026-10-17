import { describe, expect, it } from "vitest";
import { effectiveAnnualPpm, equivalentMonthlyPpm, MAX_RATE_PPM, percentText, ratePpmOf } from "./rate";

describe("rates (HU-E2-06)", () => {
  it.each([
    ["2.0", 20_000],
    ["28.59", 285_900],
    ["0", 0],
    ["100", 1_000_000],
    ["9.5", 95_000],
    ["1.3888", 13_888],
    ["10", 100_000],
    ["0.0001", 1],
    ["0.0000", 0],
    ["99.9999", 999_999],
    ["100.0000", 1_000_000],
    ["2.50", 25_000],
  ])("reads %j as %i parts per million", (percent, ppm) => {
    expect(ratePpmOf(percent)).toEqual({ ok: true, value: ppm });
  });

  it.each([
    "-1",
    "2,5",
    "100.0001",
    "1.23456",
    "",
    "abc",
    "1000",
    "999",
    "100.5",
    "2.",
    ".5",
    " 2.0",
    "2.0 ",
    "2.0\n",
    "+2",
    "1e2",
    "0x10",
    "2.5.1",
    "٢.٠",
  ])("refuses %j (Review Focus 4)", (percent) => {
    expect(ratePpmOf(percent)).toEqual({
      ok: false,
      error: { code: "InvalidRate", details: { value: percent } },
    });
  });

  it("writes a rate with exactly four decimals", () => {
    expect([percentText(20_000), percentText(268_242), percentText(0), percentText(1_000_000)]).toEqual([
      "2.0000",
      "26.8242",
      "0.0000",
      "100.0000",
    ]);
  });

  it("refuses to write a negative rate, and still writes zero", () => {
    expect(() => percentText(-1)).toThrow(RangeError);
    expect(() => percentText(-12_345)).toThrow(RangeError);
    expect(percentText(0)).toBe("0.0000");
  });

  it("pads the four decimals with zeros on the left of the fraction and cuts nothing off", () => {
    expect([1, 5, 10, 100, 1_000, 10_000, 99_999, 999_999, 4_095_000_000].map(percentText)).toEqual([
      "0.0001",
      "0.0005",
      "0.0010",
      "0.0100",
      "0.1000",
      "1.0000",
      "9.9999",
      "99.9999",
      "409500.0000",
    ]);
  });

  it.each(["2", "2.0", "2.00", "2.000", "2.0000"])("reads %j and writes it back as 2.0000", (percent) => {
    const read = ratePpmOf(percent);
    expect(read.ok && percentText(read.value)).toBe("2.0000");
  });

  it("writes every rate in range back to the same four-decimal text it reads", () => {
    const stray: number[] = [];
    for (let ppm = 0; ppm <= MAX_RATE_PPM; ppm += 1) {
      const read = ratePpmOf(percentText(ppm));
      if ((!read.ok || read.value !== ppm) && stray.length < 5) stray.push(ppm);
    }
    expect(stray).toEqual([]);
  });
});

describe("equivalent rates (HU-E2-06, ruling P52)", () => {
  it("converts 2.0 % M.V. into 26.8242 % E.A. and 18 % E.A. into 1.3888 % M.V.", () => {
    expect(percentText(effectiveAnnualPpm(20_000))).toBe("26.8242");
    expect(percentText(equivalentMonthlyPpm(180_000))).toBe("1.3888");
    expect([effectiveAnnualPpm(0), equivalentMonthlyPpm(0)]).toEqual([0, 0]);
  });

  it("refuses a negative annual rate, and still converts zero", () => {
    expect(() => equivalentMonthlyPpm(-1)).toThrow(RangeError);
    expect(equivalentMonthlyPpm(0)).toBe(0);
  });

  // 1 + EA = 2^12 puts the monthly rate at 100 % and the root at the top of the search interval, which excludes it.
  it("refuses an annual rate beyond the search interval, and still converts the last one inside it", () => {
    expect(() => equivalentMonthlyPpm(4_095_000_000)).toThrow(RangeError);
    expect(() => equivalentMonthlyPpm(5_000_000_000)).toThrow(RangeError);
    expect(equivalentMonthlyPpm(4_094_999_999)).toBe(1_000_000); // 999,999.99996
  });

  it("brings 2.0 % M.V. out and back as 2.0000 % M.V.", () => {
    expect(percentText(equivalentMonthlyPpm(effectiveAnnualPpm(20_000)))).toBe("2.0000");
  });

  // Expected values come from an independent high-precision decimal computation. Each comment gives the exact value,
  // because its fraction of a part per million is what tells rounding apart from cutting off or rounding up.
  it.each([
    [20_000, 268_242], // 268,241.79: rounds up
    [10_000, 126_825], // 126,825.03: rounds down
    [13_888, 179_994], // 179,993.99
    [50_000, 795_856], // 795,856.33
    [1, 12], // 12.000066
    [1_000_000, 4_095_000_000], // 100 % M.V. is exactly 2^12 - 1
    [829_554, 1_405_509_885], // 1,405,509,884.50000003: a hair above half, rounds up
    [344_600, 33_923_461], // 33,923,461.49999565: a hair below half, rounds down
  ])("turns %i ppm M.V. into %i ppm E.A., to the nearest part per million", (monthly, annual) => {
    expect(effectiveAnnualPpm(monthly)).toBe(annual);
  });

  it.each([
    [180_000, 13_888], // 13,888.43: rounds down
    [95_000, 7_592], // 7,591.53: rounds up
    [40_000, 3_274], // 3,273.74: rounds up
    [268_242, 20_000], // 20,000.014
    [1, 0], // 0.083: rounds down to zero
    [1_000_000, 59_463], // 100 % E.A. is 2^(1/12) - 1 = 5.9463 % M.V.
    [431_844, 30_366], // 30,365.5000070: a hair above half, rounds up
    [678_177, 44_086], // 44,086.4999989: a hair below half, rounds down
    [6, 0], // 0.4999986: a hair below half, rounds down
  ])("turns %i ppm E.A. into %i ppm M.V., to the nearest part per million", (annual, monthly) => {
    expect(equivalentMonthlyPpm(annual)).toBe(monthly);
  });

  // The rounding rule itself, stated with integers only: a result r is the nearest millionth to the exact value
  // when the exact value lies in [r - 1/2, r + 1/2); an exact half never occurs for these rates.
  it("is within half a part per million of the exact value, for rates across the whole range", () => {
    const M = 1_000_000n;
    const stray: string[] = [];
    const rates = [0, 1, 2, 999_999, 1_000_000];
    for (let ppm = 3; ppm < 1_000_000; ppm += 997) rates.push(ppm);
    for (const rate of rates) {
      const base = M + BigInt(rate);
      // EA = (base / M)^12 - 1, in ppm: exact = base^12 / M^11 - M
      const annual = BigInt(effectiveAnnualPpm(rate));
      const exact = base ** 12n - M ** 12n; // exact * M^11 = this, so compare 2 * this with (2r +- 1) * M^11
      if (!((2n * annual - 1n) * M ** 11n <= 2n * exact && 2n * exact < (2n * annual + 1n) * M ** 11n)) {
        stray.push(`EA ${rate}`);
      }
      // i_m = (base / M)^(1/12) - 1: r is nearest when ((2M + 2r -+ 1) / 2M)^12 brackets base / M
      const monthly = BigInt(equivalentMonthlyPpm(rate));
      const below = (2n * M + 2n * monthly - 1n) ** 12n * M;
      const above = (2n * M + 2n * monthly + 1n) ** 12n * M;
      const target = base * (2n * M) ** 12n;
      if (!(below <= target && target < above)) stray.push(`MV ${rate}`);
    }
    expect(stray).toEqual([]);
  });
});
