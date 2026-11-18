import {
  currencyOf,
  domainError,
  err,
  ok,
  type ExchangeRate,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import type { DatedRateReader } from "./ports";

export interface GetExchangeRateInput {
  readonly base: string;
  readonly quote: string;
  /** The day the rate is wanted for: a movement's date. */
  readonly on: LocalDate;
}

/** P342: the rate a movement of `on` converts at, and the day of the stored rate it rests on (on or before `on`). */
export interface QuotedRate {
  readonly rate: ExchangeRate;
  readonly on: LocalDate;
}

export type GetExchangeRate = (input: GetExchangeRateInput) => Promise<Result<QuotedRate>>;

/**
 * P342 (S3, S5): the day's rate between two currencies, which the app suggests an account leg from ("Tu Visa Oro en
 * pesos pagó 205.000 COP"). It reads the same stored rates the ledger converts with (D30), directly or through a pivot;
 * a code outside ISO 4217 is UnknownCurrency, and two currencies no stored rate connects by that day are
 * ExchangeRateNotFound. Rates are public facts, so any signed-in person may read them.
 */
export const createGetExchangeRate =
  (deps: { readonly rates: DatedRateReader }): GetExchangeRate =>
  async ({ base, quote, on }) => {
    for (const code of [base, quote]) {
      const known = currencyOf(code);
      if (!known.ok) return known;
    }
    const dated = await deps.rates.datedRateOn(base, quote, on);
    return dated.ok
      ? ok({ rate: dated.value.rate, on: dated.value.date })
      : err(domainError("ExchangeRateNotFound", { base, quote, on }));
  };
