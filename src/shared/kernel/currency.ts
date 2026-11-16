import { domainError } from "./domain-error";
import { CURRENCY_CODES } from "./currency-codes";
import { minorUnitsOf } from "./minor-units";
import { err, ok, type Result } from "./result";

export interface Currency {
  readonly code: string;
  /** ISO 4217 minor-unit exponent. */
  readonly exponent: number;
  /** Smallest amount used for splits and allocations, in minor units (spec 5.3). */
  readonly roundingUnit: bigint;
}

// A Map, not an object literal, so inherited keys such as "constructor" are never currencies.
const CURRENCIES: ReadonlyMap<string, Currency> = new Map(
  CURRENCY_CODES.map((code): [string, Currency] => [code, { code, ...minorUnitsOf(code) }]),
);

/** The currency with this ISO code, or undefined: for callers that only format and fall back on their own. */
export const knownCurrency = (code: string): Currency | undefined => CURRENCIES.get(code);

export const currencyOf = (code: string): Result<Currency> => {
  const currency = CURRENCIES.get(code);
  return currency ? ok(currency) : err(domainError("UnknownCurrency", { currency: code }));
};
