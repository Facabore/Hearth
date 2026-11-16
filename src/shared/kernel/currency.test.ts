import { describe, expect, it } from "vitest";
import { currencyOf, knownCurrency } from "./currency";

const exponentAndUnit = (code: string) => {
  const result = currencyOf(code);
  if (!result.ok) throw new Error(`unexpected error ${result.error.code}`);
  return [result.value.exponent, result.value.roundingUnit];
};

describe("currencyOf (D29)", () => {
  it("knows every circulating ISO 4217 currency with its minor-unit exponent", () => {
    expect(exponentAndUnit("MXN")).toEqual([2, 1n]);
    expect(exponentAndUnit("BRL")).toEqual([2, 1n]);
    expect(exponentAndUnit("JPY")).toEqual([0, 1n]);
    expect(exponentAndUnit("CLP")).toEqual([0, 1n]);
    expect(exponentAndUnit("KWD")).toEqual([3, 1n]);
    expect(exponentAndUnit("TND")).toEqual([3, 1n]);
  });

  it("keeps the currencies it knew before, COP with whole-peso splits (spec 5.3)", () => {
    expect(exponentAndUnit("COP")).toEqual([2, 100n]);
    expect(exponentAndUnit("USD")).toEqual([2, 1n]);
    expect(exponentAndUnit("EUR")).toEqual([2, 1n]);
  });

  it("refuses codes that are not a circulating ISO 4217 currency", () => {
    for (const code of ["XYZ", "usd", "XAU", "", "constructor"]) {
      const result = currencyOf(code);
      expect(!result.ok && result.error.code).toBe("UnknownCurrency");
    }
  });

  it("answers a known currency or nothing, for callers that only format", () => {
    expect(knownCurrency("JPY")?.exponent).toBe(0);
    expect(knownCurrency("XYZ")).toBeUndefined();
  });
});
