import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { withLegs, type AccountLeg, type Transaction, type TransactionLegs } from "../domain/transaction";
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
  return map(await convertedAt(deps, amount, space.currency, date), (base) => ({ base, original }));
};

/** D29, section 4.1: converts `amount` into `to` at the date's rate; ExchangeRateRequired when none connects them. */
export const convertedAt = async (
  deps: Pick<LedgerDeps, "rates">,
  amount: Money,
  to: string,
  date: LocalDate,
): Promise<Result<Money>> => {
  const rate = await deps.rates.rateOn(amount.currency.code, to, date);
  if (!rate.ok) {
    return err(domainError("ExchangeRateRequired", { from: amount.currency.code, to, date }));
  }
  return amount.convert(rate.value);
};

/**
 * D29, section 4.1: an account's leg, what the movement moves it by in its own currency. Null when the account is in the
 * base currency (it moves by `base`) or there is no account. Otherwise the amount `known` in the account's currency
 * (what was entered, or what arrived), else `base` converted at the date's rate (ExchangeRateRequired without one).
 */
export const accountLegOf = async (
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  space: Pick<SpaceMembership, "currency">,
  accountId: string | null,
  base: Money,
  known: readonly Money[],
  date: LocalDate,
): Promise<Result<AccountLeg | null>> => {
  if (accountId === null) return ok(null);
  const account = await deps.accounts.find(accountId);
  if (account === null || account.currency === space.currency) return ok(null);
  const currency = account.currency;
  const entered = known.find((amount) => amount.currency.code === currency);
  if (entered !== undefined) return ok({ amount: entered.minor, currency });
  return map(await convertedAt(deps, base, currency, date), (leg) => ({ amount: leg.minor, currency }));
};

/**
 * D29, section 4.1: every account leg of `tx`, by `accountLegOf`: an expense's payments (the entered amount is known
 * only to a sole payment, which pays it all), and the other types' source and destination accounts.
 */
export const legsOf = async (
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  space: Pick<SpaceMembership, "currency">,
  tx: Transaction,
  known: readonly Money[],
): Promise<Result<TransactionLegs>> => {
  const inBase = (minor: bigint) => Money.ofMinor(minor, tx.currency);
  const legOf = async (accountId: string | null, minor: bigint, knownHere: readonly Money[]) => {
    const base = inBase(minor);
    if (!base.ok) return base;
    return accountLegOf(deps, space, accountId, base.value, knownHere, tx.date);
  };
  if (tx.type === "EXPENSE") {
    const payments: (AccountLeg | null)[] = [];
    for (const payment of tx.payments) {
      const leg = await legOf(payment.accountId, payment.amount, tx.payments.length === 1 ? known : []);
      if (!leg.ok) return leg;
      payments.push(leg.value);
    }
    return ok({ payments });
  }
  const source = await legOf(tx.type === "INCOME" ? null : tx.sourceAccountId, tx.amount, known);
  if (!source.ok) return source;
  const destination = await legOf(tx.destinationAccountId, tx.amount, known);
  if (!destination.ok) return destination;
  return ok({ source: source.value, destination: destination.value });
};

/** D29, slice MC3: what `tx` was entered in, kept on it: its original amount and its transfer legs. */
export const knownAmountsOf = (tx: Transaction): Money[] => {
  const known: Money[] = [];
  const add = (minor: bigint | undefined, currency: string | undefined) => {
    if (minor === undefined || currency === undefined) return;
    const amount = Money.ofMinor(minor, currency);
    if (amount.ok) known.push(amount.value);
  };
  add(tx.originalAmount, tx.originalCurrency);
  if (tx.type === "TRANSFER") {
    add(tx.sourceAmount, tx.sourceCurrency);
    add(tx.destinationAmount, tx.destinationCurrency);
  }
  return known;
};

/** D29, section 4.1: `tx` with every account leg `legsOf` computes; the same type it was given. */
export const withAccountLegs = async <T extends Transaction>(
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  space: Pick<SpaceMembership, "currency">,
  tx: T,
  known: readonly Money[],
): Promise<Result<T>> => {
  const legs = await legsOf(deps, space, tx, known);
  if (!legs.ok) return legs;
  return withLegs(tx, legs.value) as Result<T>;
};
