import type { ExchangeRate, LocalDate, Result } from "@/shared/kernel";

/** One exchange rate to store: the day it is for, the pair, the exact decimal, and which source gave it. */
export interface StoredRate {
  readonly date: LocalDate;
  readonly base: string;
  readonly quote: string;
  /** The exact decimal exactly as `ExchangeRate.value` renders it. */
  readonly rate: string;
  readonly source: string;
  readonly fetchedAt: Date;
}

/**
 * D30: where daily rates are kept and read. Rates are public facts, so this store is global (no space, no user).
 */
export interface ExchangeRateRepository {
  /**
   * Stores `rates`, idempotently: a row already present for the same (date, base, quote, source) is left untouched, so
   * a re-run of the daily fetch never duplicates or rewrites a past rate.
   */
  save(rates: readonly StoredRate[]): Promise<void>;
  /**
   * `base`->`quote` as of `on`, from the latest stored rate on or before that day for each pair, resolved directly or
   * through a pivot currency (`crossRate`). `NoExchangeRate` when the currencies are not connected by that day.
   */
  rateOn(base: string, quote: string, on: LocalDate): Promise<Result<ExchangeRate>>;
}
