import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import type { StoredRate } from "../application";
import { DrizzleExchangeRates } from "./drizzle-exchange-rates";
import { exchangeRates } from "./rates.schema";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleExchangeRates(tm);

const on = (d: string) => d as LocalDate;
const at = new Date("2026-11-14T06:00:00Z");
const rate = (date: string, base: string, quote: string, value: string, source: string): StoredRate => ({
  date: on(date),
  base,
  quote,
  rate: value,
  source,
  fetchedAt: at,
});

beforeEach(async () => {
  await tm.executor().delete(exchangeRates);
});
afterAll(() => pool.end());

describe("DrizzleExchangeRates", () => {
  it("saves rates and reads a direct rate on or before a date", async () => {
    await repo.save([
      rate("2026-11-12", "EUR", "USD", "1.1000", "ecb"),
      rate("2026-11-13", "EUR", "USD", "1.1052", "ecb"),
    ]);

    const latest = await repo.rateOn("EUR", "USD", on("2026-11-13"));
    expect(latest.ok && latest.value.value).toBe("1.1052");

    const earlier = await repo.rateOn("EUR", "USD", on("2026-11-12"));
    expect(earlier.ok && earlier.value.value).toBe("1.1"); // trailing zeros trimmed
  });

  it("is idempotent on (date, base, quote, source)", async () => {
    const row = rate("2026-11-13", "EUR", "USD", "1.1052", "ecb");
    await repo.save([row]);
    await repo.save([row]); // a re-run of the daily fetch

    const rows = await tm.executor().select().from(exchangeRates);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rate).toBe("1.1052");
  });

  it("resolves a cross rate through a pivot (COP->MXN via EUR and USD)", async () => {
    await repo.save([
      rate("2026-11-13", "EUR", "USD", "1.1052", "ecb"),
      rate("2026-11-13", "EUR", "MXN", "20.5491", "ecb"),
      rate("2026-11-14", "USD", "COP", "3316.7", "trm"),
    ]);

    const r = await repo.rateOn("COP", "MXN", on("2026-11-14"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number(r.value.value)).toBeCloseTo(20.5491 / 1.1052 / 3316.7, 10);
  });

  it("keeps each pair's latest rate on or before the day, and breaks a same-day tie between sources by source key", async () => {
    await repo.save([
      rate("2026-11-10", "USD", "COP", "3300", "trm"),
      rate("2026-11-14", "USD", "COP", "3316.7", "zeta"),
      rate("2026-11-14", "USD", "COP", "3316.5", "alpha"),
      rate("2026-11-20", "USD", "COP", "3400", "trm"),
    ]);

    const tie = await repo.rateOn("USD", "COP", on("2026-11-15"));
    expect(tie.ok && tie.value.value).toBe("3316.5");
    const older = await repo.rateOn("USD", "COP", on("2026-11-12"));
    expect(older.ok && older.value.value).toBe("3300");
  });

  it("has no rate for an unconnected pair", async () => {
    await repo.save([rate("2026-11-13", "EUR", "USD", "1.1052", "ecb")]);
    const r = await repo.rateOn("JPY", "GBP", on("2026-11-13"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NoExchangeRate");
  });
});
