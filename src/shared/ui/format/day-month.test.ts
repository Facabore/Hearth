import { describe, expect, it } from "vitest";
import { formatDayMonth, formatDayMonthYear } from "./day-month";
import { formatDate, NBSP, type DateFormat } from "./formatters";

describe("formatDayMonth (D23, D27)", () => {
  it("writes the day and the short month in the order of the person's date format, never the language's", () => {
    expect(formatDayMonth("2026-11-02", "nov", { dateFormat: "DMY" })).toBe(`2${NBSP}nov`);
    expect(formatDayMonth("2026-11-02", "Nov", { dateFormat: "MDY" })).toBe(`Nov${NBSP}2`);
    expect(formatDayMonth("2026-11-12", "nov", { dateFormat: "YMD" })).toBe(`nov${NBSP}12`);
  });

  it.each<DateFormat>(["DMY", "MDY", "YMD"])("puts the day where formatDate puts it in %s", (dateFormat) => {
    const dayFirst = formatDate("2026-11-12", { dateFormat }).startsWith("12");
    expect(formatDayMonth("2026-11-12", "nov", { dateFormat }).startsWith("12")).toBe(dayFirst);
  });
});

describe("formatDayMonthYear (D23, P327)", () => {
  it("leaves the year out in today's year and writes it in any other, in the person's date order", () => {
    expect(formatDayMonthYear("2026-11-10", "nov", { dateFormat: "DMY" }, "2026-11-15")).toBe(`10${NBSP}nov`);
    expect(formatDayMonthYear("2025-11-10", "nov", { dateFormat: "DMY" }, "2026-11-15")).toBe(
      `10${NBSP}nov${NBSP}2025`,
    );
    expect(formatDayMonthYear("2026-11-10", "Nov", { dateFormat: "MDY" }, "2026-11-15")).toBe(`Nov${NBSP}10`);
    expect(formatDayMonthYear("2025-11-10", "Nov", { dateFormat: "MDY" }, "2026-11-15")).toBe(
      `Nov${NBSP}10,${NBSP}2025`,
    );
    expect(formatDayMonthYear("2025-11-10", "nov", { dateFormat: "YMD" }, "2026-11-15")).toBe(
      `2025${NBSP}nov${NBSP}10`,
    );
  });
});
