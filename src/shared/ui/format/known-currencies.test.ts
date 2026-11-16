import { describe, expect, it } from "vitest";
import { knownCurrency } from "@/shared/kernel/currency";
import { currencyName, currencyTitle } from "./currency-names";
import { knownCurrencyCodes } from "./known-currencies";

describe("currencies the sheet offers (D29, board 13)", () => {
  it("offers the ISO 4217 currencies, nearly all of them ones the kernel knows", () => {
    const codes = knownCurrencyCodes();
    expect(codes).toEqual(expect.arrayContaining(["COP", "USD", "EUR", "JPY", "MXN", "BRL"]));
    expect(codes).not.toContain("XAU");
    // The runtime's list and the kernel's differ by a handful of withdrawn or fund codes; the server refuses those.
    expect(codes.filter((code) => knownCurrency(code) === undefined).length).toBeLessThanOrEqual(6);
  });

  it("names a currency in the person's language, in a sentence and as a title", () => {
    expect(currencyName("USD", "es")).toBe("dólar estadounidense");
    expect(currencyTitle("USD", "es")).toBe("Dólar estadounidense");
    expect(currencyName("USD", "en")).toBe("US Dollar");
  });
});
