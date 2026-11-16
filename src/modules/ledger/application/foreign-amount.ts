import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import type { LedgerDeps } from "./deps";

/** D29 section 4.2: the base amount a movement is stored in, and the original it was entered in when they differ. */
export interface BaseAmount {
  /** The stored base amount, always in the space's base currency. */
  readonly base: Money;
  /** D29: what was charged and in which currency; present only when the entered amount was in another currency. */
  readonly original?: { readonly amount: bigint; readonly currency: string };
}

/**
 * D29 section 4.2, D30: the base amount (the space's base currency) a recorded movement stores, and its original.
 *
 * - An amount already in the base currency is unchanged: the base is it, and nothing original is kept (the path every
 *   caller before MC3 takes, byte for byte).
 * - An amount in another currency keeps the original, and its base is the real `convertedAmount` when the person gave
 *   one (what the bank charged, which must be in the base currency, else `CurrencyMismatch`), otherwise the date's rate
 *   (`ExchangeRateRequired` when no rate connects the currencies that day). The base's positivity is the domain's.
 */
export const baseAmountOf = async (
  deps: Pick<LedgerDeps, "rates">,
  space: SpaceMembership,
  amount: Money,
  convertedAmount: Money | undefined,
  date: LocalDate,
): Promise<Result<BaseAmount>> => {
  if (amount.currency.code === space.currency) return ok({ base: amount });
  const original = { amount: amount.minor, currency: amount.currency.code };
  if (convertedAmount !== undefined) {
    return convertedAmount.currency.code === space.currency
      ? ok({ base: convertedAmount, original })
      : err(
          domainError("CurrencyMismatch", {
            expected: space.currency,
            actual: convertedAmount.currency.code,
          }),
        );
  }
  const rate = await deps.rates.rateOn(amount.currency.code, space.currency, date);
  if (!rate.ok) {
    return err(domainError("ExchangeRateRequired", { from: amount.currency.code, to: space.currency, date }));
  }
  return map(amount.convert(rate.value), (base) => ({ base, original }));
};
