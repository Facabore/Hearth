import { describe, expect, it } from "vitest";
import { minorOf, parseDecimal } from "./amount-input";

describe("amount input (ruling P138)", () => {
  it("reads what a person types in their number format", () => {
    expect(parseDecimal("4.000.000", "DOT_COMMA")).toBe("4000000");
    expect(parseDecimal("4000000", "DOT_COMMA")).toBe("4000000");
    expect(parseDecimal("1,89", "DOT_COMMA")).toBe("1.89");
    expect(parseDecimal("1,234,567.89", "COMMA_DOT")).toBe("1234567.89");
    expect(parseDecimal("1 234 567,89", "SPACE_COMMA")).toBe("1234567.89");
    expect(parseDecimal("1 234 567,89", "SPACE_COMMA")).toBe("1234567.89");
    expect(parseDecimal(" 85.000 ", "DOT_COMMA")).toBe("85000");
  });

  it("refuses what is not a number in that format", () => {
    for (const text of ["", "abc", "1,2,3", "1.23", "12.34.5", "-5", "1e5"])
      expect(parseDecimal(text, "DOT_COMMA")).toBeNull();
  });

  it("turns a decimal into minor units of the currency, refusing extra decimals", () => {
    expect(minorOf("85000", 2)).toBe("8500000");
    expect(minorOf("12.5", 2)).toBe("1250");
    expect(minorOf("0.05", 2)).toBe("5");
    expect(minorOf("1.234", 2)).toBeNull();
  });
});
