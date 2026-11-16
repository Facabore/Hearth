import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import type { TermsChange } from "../domain/account-terms";

/** D29: an account's amounts are in its own currency; amounts in any other currency are rejected. */
export const minorIn = (currency: string, money: Money): Result<bigint> =>
  money.currency.code === currency
    ? ok(money.minor)
    : err(domainError("CurrencyMismatch", { expected: currency, actual: money.currency.code }));

/** HU-E2-06: terms as the use cases take them; money terms are Money in the account's currency (D29). */
export type TermsInput = Omit<TermsChange, "creditLimit" | "principal"> & {
  readonly creditLimit?: Money | null;
  readonly principal?: Money | null;
};

/** The terms in minor units of `currency` (CurrencyMismatch). */
export const termsIn = (currency: string, input: TermsInput | undefined): Result<TermsChange> => {
  if (input === undefined) return ok({});
  const minor = (money: Money | null | undefined): Result<bigint | null | undefined> =>
    money === undefined || money === null ? ok(money) : minorIn(currency, money);
  const creditLimit = minor(input.creditLimit);
  if (!creditLimit.ok) return creditLimit;
  const principal = minor(input.principal);
  if (!principal.ok) return principal;
  return ok({ ...input, creditLimit: creditLimit.value, principal: principal.value });
};
