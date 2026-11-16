import { asc, desc, eq, lte, min } from "drizzle-orm";
import { ok, type ExchangeRate, type LocalDate, type Result } from "@/shared/kernel";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { ExchangeRateRepository, StoredRate } from "../application";
import { rateFromRows, type RateRow } from "../domain";
import { exchangeRates } from "./rates.schema";

/** Rows per INSERT: 6,000 parameters, far below PostgreSQL's 65,535. */
const SAVE_BATCH = 1000;

/**
 * D30: the daily rates table. `save` inserts forward-only, ignoring a pair already stored for the day and source, so a
 * re-run never duplicates or rewrites a past rate. `rateOn` reads only each pair's latest rate on or before the day
 * (one row per pair, a same-day tie between sources going to the lower source key), so a lookup stays the same size
 * as history grows, and lets the domain resolve the asked pair, directly or through a pivot.
 */
export class DrizzleExchangeRates implements ExchangeRateRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async save(rates: readonly StoredRate[]): Promise<void> {
    // A history is tens of thousands of rows; PostgreSQL takes at most 65,535 parameters per statement (6 per row),
    // so it goes in batches, inside one transaction so a failed batch leaves no gap behind.
    await this.tm.run(async () => {
      for (let at = 0; at < rates.length; at += SAVE_BATCH) {
        await this.tm
          .executor()
          .insert(exchangeRates)
          .values(
            rates.slice(at, at + SAVE_BATCH).map((r) => ({
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
      return ok(undefined);
    });
  }

  async rateOn(base: string, quote: string, on: LocalDate): Promise<Result<ExchangeRate>> {
    const rows = await this.tm
      .executor()
      .selectDistinctOn([exchangeRates.base, exchangeRates.quote], {
        date: exchangeRates.date,
        base: exchangeRates.base,
        quote: exchangeRates.quote,
        rate: exchangeRates.rate,
      })
      .from(exchangeRates)
      .where(lte(exchangeRates.date, on))
      .orderBy(
        asc(exchangeRates.base),
        asc(exchangeRates.quote),
        desc(exchangeRates.date),
        asc(exchangeRates.source),
      );
    return rateFromRows(rows as RateRow[], base, quote, on);
  }

  async earliestDate(source: string): Promise<LocalDate | null> {
    const [row] = await this.tm
      .executor()
      .select({ earliest: min(exchangeRates.date) })
      .from(exchangeRates)
      .where(eq(exchangeRates.source, source));
    return (row?.earliest ?? null) as LocalDate | null;
  }
}
