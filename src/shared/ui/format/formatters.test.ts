import { describe, expect, it } from "vitest";
import {
  BUILT_IN_FORMATS,
  decimalOf,
  formatDate,
  formatDirectedMoney,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSignedMoney,
  formatTime,
  formatTimeAt,
  MINUS,
  NBSP,
  WORD_JOINER,
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
    ["DOT_COMMA", "DMY", "H24", "1.600.000 COP", "5/10/2026", "14:30"],
    ["COMMA_DOT", "MDY", "H12", "1,600,000 COP", "10/5/2026", "2:30 PM"],
    ["DOT_COMMA", "DMY", "H24", "1.600.000 COP", "5/10/2026", "14:30"],
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

  it("drops a zero fraction and keeps another one whole", () => {
    expect(norm(formatMoney({ amount: "123456789", currency: "COP" }, BUILT_IN_FORMATS))).toBe(
      "1.234.567,89 COP",
    );
    expect(norm(formatMoney({ amount: "123456780", currency: "COP" }, BUILT_IN_FORMATS))).toBe(
      "1.234.567,80 COP",
    );
    expect(norm(formatMoney({ amount: "1250", currency: "USD" }, formats("COMMA_DOT", "MDY", "H12")))).toBe(
      "12.50 USD",
    );
    expect(decimalOf("5", 2)).toBe("0.05");
    expect(decimalOf("-922337203685477580", 2)).toBe("-9223372036854775.80");
  });

  it("writes any ISO 4217 currency with its own exponent (D29)", () => {
    expect(norm(formatMoney({ amount: "150000", currency: "JPY" }, BUILT_IN_FORMATS))).toBe("150.000 JPY");
    expect(norm(formatMoney({ amount: "1500", currency: "KWD" }, BUILT_IN_FORMATS))).toBe("1,500 KWD");
  });
});

describe("an amount reads number, no-break space, ISO code and no symbol (P342)", () => {
  const money = (amount: string, currency: string) => formatMoney({ amount, currency }, BUILT_IN_FORMATS);

  it("writes a positive amount with the code after it", () => {
    expect(money("50000000", "COP")).toBe(`500.000${NBSP}COP`);
    expect(money("5000", "USD")).toBe(`50${NBSP}USD`);
    expect(money("6000", "EUR")).toBe(`60${NBSP}EUR`);
  });

  it("writes a negative amount with U+2212 and a word joiner before the digits", () => {
    expect(WORD_JOINER).toBe("\u2060");
    expect(money("-5000", "USD")).toBe(`${MINUS}${WORD_JOINER}50${NBSP}USD`);
    expect(money("-35000000", "COP")).toBe(`${MINUS}${WORD_JOINER}350.000${NBSP}COP`);
  });

  it("writes zero as a bare 0 with its code", () => {
    expect(money("0", "COP")).toBe(`0${NBSP}COP`);
  });

  it("keeps the currency's own decimals: two for USD, none for JPY", () => {
    expect(money("5050", "USD")).toBe(`50,50${NBSP}USD`);
    expect(money("150000", "JPY")).toBe(`150.000${NBSP}JPY`);
  });

  it("writes a currency Hearth never had a symbol for the same way", () => {
    expect(money("100000", "MXN")).toBe(`1.000${NBSP}MXN`);
    expect(money("-1999", "MXN")).toBe(`${MINUS}${WORD_JOINER}19,99${NBSP}MXN`);
  });

  it("follows the person's number format for the digits", () => {
    const amount = { amount: "123456750", currency: "COP" };
    expect(formatMoney(amount, { numberFormat: "DOT_COMMA" })).toBe(`1.234.567,50${NBSP}COP`);
    expect(formatMoney(amount, { numberFormat: "COMMA_DOT" })).toBe(`1,234,567.50${NBSP}COP`);
    expect(formatMoney(amount, { numberFormat: "SPACE_COMMA" })).toBe(`1${NBSP}234${NBSP}567,50${NBSP}COP`);
  });
});

describe("times (HU-E9-02 outline, ruling P121)", () => {
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

  it("signs an amount of change: + above zero, U+2212 and a word joiner below, nothing at zero (P342)", () => {
    expect(formatSignedMoney({ amount: "6000", currency: "EUR" }, BUILT_IN_FORMATS)).toBe(`+60${NBSP}EUR`);
    expect(formatSignedMoney({ amount: "-5000", currency: "USD" }, BUILT_IN_FORMATS)).toBe(
      `${MINUS}${WORD_JOINER}50${NBSP}USD`,
    );
    expect(formatSignedMoney({ amount: "0", currency: "COP" }, BUILT_IN_FORMATS)).toBe(`0${NBSP}COP`);
  });

  it("writes an amount in the direction its movement goes: − out, + in, nothing for a move (P342)", () => {
    const money = { amount: "5000", currency: "USD" };
    expect(formatDirectedMoney(money, "-", BUILT_IN_FORMATS)).toBe(`${MINUS}${WORD_JOINER}50${NBSP}USD`);
    expect(formatDirectedMoney(money, "+", BUILT_IN_FORMATS)).toBe(`+50${NBSP}USD`);
    expect(formatDirectedMoney(money, null, BUILT_IN_FORMATS)).toBe(`50${NBSP}USD`);
  });
});
