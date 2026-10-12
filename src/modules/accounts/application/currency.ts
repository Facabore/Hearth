import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";

/** D6: one currency per space; amounts in any other currency are rejected. */
export const minorIn = (spaceCurrency: string, money: Money): Result<bigint> =>
  money.currency.code === spaceCurrency
    ? ok(money.minor)
    : err(domainError("CurrencyMismatch", { expected: spaceCurrency, actual: money.currency.code }));
