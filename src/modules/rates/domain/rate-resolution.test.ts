import { describe, expect, it } from "vitest";
import { type LocalDate } from "@/shared/kernel";
import { rateFromRows, type RateRow } from "./rate-resolution";

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
