import { domainError } from "./domain-error";
import { err, ok, type Result } from "./result";

export interface Currency {
  readonly code: string;
  /** ISO 4217 minor-unit exponent. */
  readonly exponent: number;
  /** Smallest amount used for splits and allocations, in minor units (spec 5.3). */
  readonly roundingUnit: bigint;
}

const CURRENCIES: Readonly<Record<string, Currency>> = {
  COP: { code: "COP", exponent: 2, roundingUnit: 100n },
  USD: { code: "USD", exponent: 2, roundingUnit: 1n },
  EUR: { code: "EUR", exponent: 2, roundingUnit: 1n },
};

export const currencyOf = (code: string): Result<Currency> => {
  const currency = CURRENCIES[code];
  return currency ? ok(currency) : err(domainError("UnknownCurrency", { currency: code }));
};
