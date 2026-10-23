import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FORMATS,
  decimalOf,
  formatDate,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSignedMoney,
  formatTime,
  formatTimeAt,
  MINUS,
  NBSP,
  type Formats,
} from "./formatters";

const norm = (text: string) => text.replace(/\s/g, " ");
const formats = (
  numberFormat: Formats["numberFormat"],
  dateFormat: Formats["dateFormat"],
  timeFormat: Formats["timeFormat"],
): Formats => ({
  numberFormat,
  dateFormat,
  timeFormat,
  weekStart: "MONDAY",
});

describe("formatters (HU-E9-02 outline, ruling P121): the preferences, never the language", () => {
  // The outline's three rows; the locale column is absent on purpose: no formatter takes one.
  it.each([
    ["DOT_COMMA", "DMY", "H24", "$ 1.600.000", "5/10/2026", "14:30"],
    ["COMMA_DOT", "MDY", "H12", "$ 1,600,000", "10/5/2026", "2:30 PM"],
    ["DOT_COMMA", "DMY", "H24", "$ 1.600.000", "5/10/2026", "14:30"],
  ] as const)("%s %s %s → %s, %s, %s", (numberFormat, dateFormat, timeFormat, amount, date, time) => {
    const f = formats(numberFormat, dateFormat, timeFormat);
    expect(norm(formatMoney({ amount: "160000000", currency: "COP" }, f))).toBe(amount);
    expect(formatDate("2026-10-05", f)).toBe(date);
    expect(norm(formatTime({ hour: 14, minute: 30 }, f))).toBe(time);
  });

  it("writes the other patterns of the story", () => {
    expect(norm(formatNumber("1234567.89", formats("SPACE_COMMA", "DMY", "H24")))).toBe("1 234 567,89");
    expect(formatNumber("1234567.89", BUILT_IN_FORMATS)).toBe("1.234.567,89");
    expect(formatNumber("1234567.89", formats("COMMA_DOT", "DMY", "H24"))).toBe("1,234,567.89");
    expect(formatDate("2026-10-05", formats("DOT_COMMA", "YMD", "H24"))).toBe("2026/10/5");
    expect(formatDate("2026-10-16", BUILT_IN_FORMATS)).toBe("16/10/2026");
  });

  it("drops a zero fraction, keeps another one whole and puts the minus before the symbol", () => {
    expect(norm(formatMoney({ amount: "123456789", currency: "COP" }, BUILT_IN_FORMATS))).toBe(
      "$ 1.234.567,89",
    );
    expect(norm(formatMoney({ amount: "123456780", currency: "COP" }, BUILT_IN_FORMATS))).toBe(
      "$ 1.234.567,80",
    );
    expect(norm(formatMoney({ amount: "-35000000", currency: "COP" }, BUILT_IN_FORMATS))).toBe("−$ 350.000");
    expect(norm(formatMoney({ amount: "0", currency: "COP" }, BUILT_IN_FORMATS))).toBe("$ 0");
    expect(norm(formatMoney({ amount: "1250", currency: "USD" }, formats("COMMA_DOT", "MDY", "H12")))).toBe(
      "US$ 12.50",
    );
    expect(decimalOf("5", 2)).toBe("0.05");
    expect(decimalOf("-922337203685477580", 2)).toBe("-9223372036854775.80");
  });

  it("writes 24-hour times with two-digit hours and 12-hour times with AM and PM", () => {
    expect(formatTime({ hour: 8, minute: 10 }, BUILT_IN_FORMATS)).toBe("08:10");
    const twelve = formats("DOT_COMMA", "DMY", "H12");
    expect(norm(formatTime({ hour: 0, minute: 5 }, twelve))).toBe("12:05 AM");
    expect(norm(formatTime({ hour: 12, minute: 0 }, twelve))).toBe("12:00 PM");
    expect(norm(formatTime({ hour: 19, minute: 0 }, twelve))).toBe("7:00 PM");
  });

  it("reads an instant on the clock of the record's own zone", () => {
    expect(formatTimeAt("2026-11-01T04:30:00Z", "America/Bogota", BUILT_IN_FORMATS)).toBe("23:30");
    expect(formatTimeAt("2026-11-01T04:30:00Z", "Europe/Madrid", BUILT_IN_FORMATS)).toBe("05:30");
  });
});

describe("percentages and signed amounts (ruling P204)", () => {
  it("keeps two decimals in the person's number format, with a non-breaking space before %", () => {
    expect(formatPercent("40.00", BUILT_IN_FORMATS)).toBe(`40,00${NBSP}%`);
    expect(formatPercent("36.75", BUILT_IN_FORMATS)).toBe(`36,75${NBSP}%`);
    expect(formatPercent("1234.50", BUILT_IN_FORMATS)).toBe(`1.234,50${NBSP}%`);
    expect(formatPercent("100.00", { numberFormat: "COMMA_DOT" })).toBe(`100.00${NBSP}%`);
  });

  it("writes a negative change with U+2212 and a positive one with + only when asked", () => {
    expect(formatPercent("-3.70", BUILT_IN_FORMATS)).toBe(`${MINUS}3,70${NBSP}%`);
    expect(formatPercent("3.70", BUILT_IN_FORMATS, { signed: true })).toBe(`+3,70${NBSP}%`);
    expect(formatPercent("3.70", BUILT_IN_FORMATS)).toBe(`3,70${NBSP}%`);
    expect(formatPercent("0.00", BUILT_IN_FORMATS, { signed: true })).toBe(`0,00${NBSP}%`);
    expect(formatPercent("-0.00", BUILT_IN_FORMATS)).toBe(`0,00${NBSP}%`);
  });

  it("signs an amount of change: + above zero, U+2212 below, nothing at zero", () => {
    expect(formatSignedMoney({ amount: "5000000", currency: "COP" }, BUILT_IN_FORMATS)).toBe(
      `+$${NBSP}50.000`,
    );
    expect(formatSignedMoney({ amount: "-5000000", currency: "COP" }, BUILT_IN_FORMATS)).toBe(
      `${MINUS}$${NBSP}50.000`,
    );
    expect(formatSignedMoney({ amount: "0", currency: "COP" }, BUILT_IN_FORMATS)).toBe(`$${NBSP}0`);
  });
});
