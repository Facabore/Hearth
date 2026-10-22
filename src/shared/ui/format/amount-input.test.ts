import { describe, expect, it } from "vitest";
import { caretAfter, groupAmountInput, minorOf, parseDecimal, significantBefore } from "./amount-input";
import type { NumberFormat } from "./formatters";

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

describe("grouping the digits while typing (U3)", () => {
  const NBSP = " ";
  it.each<[string, NumberFormat, number, string]>([
    ["6", "DOT_COMMA", 0, "6"],
    ["6000", "DOT_COMMA", 0, "6.000"],
    ["60000", "DOT_COMMA", 0, "60.000"],
    ["1234567", "DOT_COMMA", 0, "1.234.567"],
    ["6.0000", "DOT_COMMA", 0, "60.000"],
    ["1.23", "DOT_COMMA", 0, "123"],
    ["007", "DOT_COMMA", 0, "7"],
    ["0", "DOT_COMMA", 0, "0"],
    ["", "DOT_COMMA", 0, ""],
    ["abc", "DOT_COMMA", 0, ""],
    ["6000", "COMMA_DOT", 0, "6,000"],
    ["6000", "SPACE_COMMA", 0, `6${NBSP}000`],
    ["1234567,89", "DOT_COMMA", 2, "1.234.567,89"],
    ["1234567.89", "COMMA_DOT", 2, "1,234,567.89"],
    ["1234,", "DOT_COMMA", 2, "1.234,"],
    [",5", "DOT_COMMA", 2, "0,5"],
    ["1.234,56", "DOT_COMMA", 2, "1.234,56"],
  ])("%j in %s with %i decimals → %j", (typed, format, exponent, grouped) => {
    expect(groupAmountInput(typed, format, exponent)).toBe(grouped);
  });

  it("leaves a point in a currency without decimals as typed, so the unreadable-amount message answers", () => {
    expect(groupAmountInput("6,5", "DOT_COMMA", 0)).toBe("6,5");
    expect(groupAmountInput("6000,5", "DOT_COMMA", 0)).toBe("6000,5");
    expect(parseDecimal("6,5", "DOT_COMMA")).toBe("6.5");
  });

  it("keeps a lone group separator before one or two digits as typed when the currency has decimals", () => {
    // "12.50" in a dot-and-comma format is a point typed by habit, not a grouping: do not turn it into 1250.
    expect(groupAmountInput("12.50", "DOT_COMMA", 2)).toBe("12.50");
    expect(parseDecimal("12.50", "DOT_COMMA")).toBeNull();
  });

  it("regroups after a deletion, however few digits follow the last separator", () => {
    expect(groupAmountInput("6.00", "DOT_COMMA", 2, "6.000")).toBe("600");
    expect(groupAmountInput("6.0", "DOT_COMMA", 2, "6.00")).toBe("60");
    expect(groupAmountInput("1.23", "DOT_COMMA", 2, "1.234")).toBe("123");
    expect(groupAmountInput("1.234.56", "DOT_COMMA", 2, "1.234.567")).toBe("123.456");
  });

  it("leaves a separator typed or pasted by habit as typed, until a deletion", () => {
    expect(groupAmountInput("12.5", "DOT_COMMA", 2, "12")).toBe("12.5");
    expect(groupAmountInput("12.50", "DOT_COMMA", 2, "12.5")).toBe("12.50");
    expect(groupAmountInput("12.50", "DOT_COMMA", 2, "")).toBe("12.50");
  });

  it("never changes the value it parses to", () => {
    for (const [typed, format, exponent] of [
      ["6000", "DOT_COMMA", 0],
      ["1234567", "COMMA_DOT", 0],
      ["1234567,89", "DOT_COMMA", 2],
      ["8500", "SPACE_COMMA", 0],
    ] as const) {
      const grouped = groupAmountInput(typed, format, exponent);
      expect(grouped).not.toBe(typed.length > 3 ? typed : "never");
      expect(parseDecimal(grouped, format)).toBe(parseDecimal(typed, format));
    }
  });

  it("counts the digits and the point before the caret", () => {
    expect(significantBefore("1.234,5", 5, "DOT_COMMA")).toBe(4);
    expect(significantBefore("1.234,5", 6, "DOT_COMMA")).toBe(5);
    expect(significantBefore("6.000", 0, "DOT_COMMA")).toBe(0);
  });

  it("places the caret after the same digits it was after before the grouping", () => {
    // "6.0|00" is typed as "6.0100" with the caret after "6.01"; it becomes "60.100": the caret stays after "601".
    expect(caretAfter("60.100", 3, "DOT_COMMA")).toBe(4);
    expect(caretAfter("6.000", 0, "DOT_COMMA")).toBe(0);
    expect(caretAfter("6.000", 4, "DOT_COMMA")).toBe(5);
    expect(caretAfter("6.000", 9, "DOT_COMMA")).toBe(5);
    expect(caretAfter("1.234,5", 5, "DOT_COMMA")).toBe(6);
  });
});
