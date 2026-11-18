import { describe, expect, it } from "vitest";
import { currencyOf as kernelCurrency } from "@/shared/kernel/currency";
import { currencyOf } from "./currencies";

describe("currencies (ruling P183, D29)", () => {
  it("rounds and writes every currency like the server: whole pesos for COP, each currency's own exponent", () => {
    for (const code of ["COP", "USD", "EUR", "JPY", "KWD", "MXN"]) {
      const server = kernelCurrency(code);
      if (!server.ok) throw new Error(code);
      expect([currencyOf(code).exponent, currencyOf(code).roundingUnit]).toEqual([
        server.value.exponent,
        server.value.roundingUnit,
      ]);
    }
  });

  it("carries no symbol: an amount shows its code (P342), and an unknown code takes two decimals", () => {
    expect(currencyOf("XYZ")).toEqual({ exponent: 2, roundingUnit: 1n });
  });
});
