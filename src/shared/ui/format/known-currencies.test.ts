import { describe, expect, it } from "vitest";
import { knownCurrency } from "@/shared/kernel/currency";
import { currencyName, currencyTitle } from "./currency-names";
import { knownCurrencyCodes } from "./known-currencies";

describe("currencies the sheet offers (D29, board 13)", () => {
  it("offers exactly the currencies the server accepts, in code order", () => {
    const codes = knownCurrencyCodes();
    expect(codes).toEqual(expect.arrayContaining(["COP", "USD", "EUR", "JPY", "MXN", "BRL", "VED"]));
    for (const refused of ["XAU", "XDR", "XSU", "CUC", "SLL", "ZWL"]) expect(codes).not.toContain(refused);
    expect(codes.every((code) => knownCurrency(code) !== undefined)).toBe(true);
    expect([...codes].sort()).toEqual(codes);
  });

  it("names a currency in the person's language, in a sentence and as a title", () => {
    expect(currencyName("USD", "es")).toBe("dólar estadounidense");
    expect(currencyTitle("USD", "es")).toBe("Dólar estadounidense");
    expect(currencyName("USD", "en")).toBe("US Dollar");
  });
});
