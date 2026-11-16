import { describe, expect, it } from "vitest";
import { type LocalDate } from "@/shared/kernel";
import { datedRateFromRows, rateFromRows, type RateRow } from "./rate-resolution";

const on = (d: string) => d as LocalDate;
const row = (date: string, base: string, quote: string, rate: string): RateRow => ({
  date: on(date),
  base,
  quote,
  rate,
});

describe("rateFromRows", () => {
  const rows: RateRow[] = [
    row("2026-11-12", "EUR", "USD", "1.1000"),
    row("2026-11-13", "EUR", "USD", "1.1052"),
    row("2026-11-13", "EUR", "MXN", "20.5491"),
    row("2026-11-14", "USD", "COP", "3316.7"),
  ];

  it("takes the latest rate on or before the date", () => {
    const r = rateFromRows(rows, "EUR", "USD", on("2026-11-13"));
    expect(r.ok && r.value.value).toBe("1.1052");
  });

  it("ignores rows after the date", () => {
    const r = rateFromRows(rows, "EUR", "USD", on("2026-11-12"));
    expect(r.ok && r.value.value).toBe("1.1"); // 2026-11-12's 1.1000, trailing zeros trimmed by ExchangeRate
  });

  it("has no rate before its first row", () => {
    const r = rateFromRows(rows, "USD", "COP", on("2026-11-13"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NoExchangeRate");
  });

  it("resolves a cross rate through the pivot (COP->MXN)", () => {
    const r = rateFromRows(rows, "COP", "MXN", on("2026-11-14"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number(r.value.value)).toBeCloseTo(20.5491 / 1.1052 / 3316.7, 10);
  });

  it("reports an unconnected currency", () => {
    const r = rateFromRows(rows, "JPY", "GBP", on("2026-11-14"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NoExchangeRate");
  });
});

describe("datedRateFromRows (D29, slice MC4)", () => {
  const rows: RateRow[] = [
    row("2026-11-05", "USD", "COP", "4050"),
    row("2026-11-15", "USD", "COP", "4100"),
    row("2026-11-03", "EUR", "USD", "1.1"),
  ];

  it("answers the day of the stored rate it used, not the day asked for", () => {
    const r = datedRateFromRows(rows, "USD", "COP", on("2026-11-16"));
    expect(r.ok && [r.value.rate.value, r.value.date, r.value.stale]).toEqual(["4100", "2026-11-15", false]);
  });

  it("dates an inverted rate by its stored row", () => {
    const r = datedRateFromRows(rows, "COP", "USD", on("2026-11-10"));
    expect(r.ok && r.value.date).toBe("2026-11-05");
  });

  it("dates a cross rate by the oldest stored rate it went through", () => {
    // EUR->COP goes EUR->USD (2026-11-03) then USD->COP (2026-11-15): the answer rests on 3 November too.
    const r = datedRateFromRows(rows, "EUR", "COP", on("2026-11-16"));
    expect(r.ok && r.value.date).toBe("2026-11-03");
  });

  it("flags a rate more than 7 days older than the day asked for, and keeps it", () => {
    // 2026-11-05 is 9 days before 2026-11-14: still answered, and flagged stale.
    const old = datedRateFromRows(rows, "USD", "COP", on("2026-11-14"));
    expect(old.ok && [old.value.rate.value, old.value.stale]).toEqual(["4050", true]);
    // Exactly 7 days old is not stale yet.
    const week = datedRateFromRows(rows, "USD", "COP", on("2026-11-12"));
    expect(week.ok && week.value.stale).toBe(false);
  });

  it("has no rate when the currencies are not connected by that day", () => {
    const r = datedRateFromRows(rows, "USD", "COP", on("2026-11-01"));
    expect(!r.ok && r.error.code).toBe("NoExchangeRate");
  });
});
