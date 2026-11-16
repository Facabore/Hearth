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

  it("shows Hearth's symbols, and the code itself for any other currency", () => {
    expect(["COP", "USD", "EUR", "JPY"].map((code) => currencyOf(code).symbol)).toEqual([
      "$",
      "US$",
      "€",
      "JPY",
    ]);
    expect(currencyOf("XYZ")).toEqual({ symbol: "XYZ", exponent: 2, roundingUnit: 1n });
  });
});
