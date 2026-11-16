import { lte } from "drizzle-orm";
import type { ExchangeRate, LocalDate, Result } from "@/shared/kernel";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { ExchangeRateRepository, StoredRate } from "../application";
import { rateFromRows, type RateRow } from "../domain";
import { exchangeRates } from "./rates.schema";

/**
 * D30: the daily rates table. `save` inserts forward-only, ignoring a pair already stored for the day and source, so a
 * re-run never duplicates or rewrites a past rate. `rateOn` reads every pair's latest rate on or before the day and
 * lets the domain resolve the asked pair, directly or through a pivot.
 */
export class DrizzleExchangeRates implements ExchangeRateRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async save(rates: readonly StoredRate[]): Promise<void> {
    if (rates.length === 0) return;
    await this.tm
      .executor()
      .insert(exchangeRates)
      .values(
        rates.map((r) => ({
          date: r.date,
          base: r.base,
          quote: r.quote,
          rate: r.rate,
          source: r.source,
          fetchedAt: r.fetchedAt,
        })),
      )
      .onConflictDoNothing();
  }

  async rateOn(base: string, quote: string, on: LocalDate): Promise<Result<ExchangeRate>> {
    const rows = await this.tm
      .executor()
      .select({
        date: exchangeRates.date,
        base: exchangeRates.base,
        quote: exchangeRates.quote,
        rate: exchangeRates.rate,
      })
      .from(exchangeRates)
      .where(lte(exchangeRates.date, on));
    return rateFromRows(rows as RateRow[], base, quote, on);
  }
}
