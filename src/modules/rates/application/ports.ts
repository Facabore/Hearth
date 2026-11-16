import type { ExchangeRate, LocalDate, Result } from "@/shared/kernel";

/** One quote a source gives against its base currency, as an exact decimal string. */
export interface SourceRate {
  readonly quote: string;
  readonly rate: string;
}

/** A day's rates from one source, all against its single base currency (EUR for ECB, USD for TRM). */
export interface SourceRates {
  readonly source: string;
  readonly base: string;
  readonly date: LocalDate;
  readonly rates: readonly SourceRate[];
}

/**
 * D30: an outbound source of daily rates. `fetch` reads the source's latest publication and parses it; a network or
 * parse failure is a `Result` error (`ExchangeRateSourceUnavailable`), never a throw, so the daily job keeps the other
 * sources.
 */
export interface ExchangeRateSource {
  readonly key: string;
  fetch(): Promise<Result<SourceRates>>;
}

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
