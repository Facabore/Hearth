import { describe, expect, it } from "vitest";
import { currencyOf as kernelCurrency } from "@/shared/kernel/currency";
import { currencyOf } from "./currencies";

describe("currencies (ruling P183)", () => {
  it("rounds splits by the same unit as the server: whole pesos for COP, cents for USD and EUR", () => {
    for (const code of ["COP", "USD", "EUR"]) {
      const server = kernelCurrency(code);
      if (!server.ok) throw new Error(code);
      expect([currencyOf(code).exponent, currencyOf(code).roundingUnit]).toEqual([
        server.value.exponent,
        server.value.roundingUnit,
      ]);
    }
    expect(currencyOf("XYZ").roundingUnit).toBe(1n);
  });
});
