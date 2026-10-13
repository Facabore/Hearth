import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysInMonth, fromParts, localDate, partsOf } from "./local-date";
import { isErr, isOk } from "./result";

describe("LocalDate", () => {
  it("accepts valid ISO dates and rejects impossible ones", () => {
    expect(isOk(localDate("2028-02-29"))).toBe(true);
    const bad = localDate("2027-02-29");
    expect(isErr(bad) && bad.error.code).toBe("InvalidDate");
    expect(isErr(localDate("2026-1-5"))).toBe(true);
    expect(isErr(localDate("2026-13-01"))).toBe(true);
    expect(isErr(localDate("2026-00-10"))).toBe(true);
  });

  it("knows month lengths including leap years", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays(fromParts(2026, 12, 31), 1)).toBe("2027-01-01");
    expect(addDays(fromParts(2026, 11, 1), -1)).toBe("2026-10-31");
  });

  it("adds months across years", () => {
    expect(addMonths(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("splits into parts", () => {
    expect(partsOf(fromParts(2026, 3, 9))).toEqual({ year: 2026, month: 3, day: 9 });
  });
});

describe("supported years", () => {
  // PostgreSQL has no year 0, and Date.UTC maps years 0-99 to 1900-1999.
  it.each(["0000-06-15", "0050-03-01", "1899-12-31"])("rejects %s as InvalidDate", (iso) => {
    const result = localDate(iso);
    expect(isErr(result) && result.error.code).toBe("InvalidDate");
  });

  it("accepts the first supported day", () => {
    expect(isOk(localDate("1900-01-01"))).toBe(true);
  });
});
