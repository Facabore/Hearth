import { describe, expect, it } from "vitest";
import { knownCurrency } from "@/shared/kernel/currency";
import { currencyName, currencyTitle } from "./currency-names";
import { knownCurrencyCodes } from "./known-currencies";

describe("currency names (D29, board 13)", () => {
  it("lists every currency the kernel knows, and only those", () => {
    const codes = knownCurrencyCodes();
    expect(codes).toEqual(expect.arrayContaining(["COP", "USD", "EUR", "JPY", "MXN", "BRL", "XCG"]));
    expect(codes.every((code) => knownCurrency(code) !== undefined)).toBe(true);
    expect(codes).not.toContain("XAU");
  });

  it("names a currency in the person's language, in a sentence and as a title", () => {
    expect(currencyName("USD", "es")).toBe("dólar estadounidense");
    expect(currencyTitle("USD", "es")).toBe("Dólar estadounidense");
    expect(currencyName("USD", "en")).toBe("US Dollar");
  });
});
