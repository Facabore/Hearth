import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { withLegs, type AccountLeg, type Transaction, type TransactionLegs } from "../domain/transaction";
import type { LedgerDeps } from "./deps";

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
 * D29 section 4.1, P342: an account's leg, what the movement moves it by in its own currency. Null when there is no
 * account or the account is in the movement's own currency (`amount`'s, which is what it moves by). Otherwise the amount
 * `known` in the account's currency (what was entered, or what arrived), else `amount` converted at the date's rate
 * (ExchangeRateRequired without one). `space` is no longer read (P342: the movement's currency decides, not the space's);
 * it stays for the callers that still pass it.
 */
export const accountLegOf = async (
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  space: Pick<SpaceMembership, "currency">,
  accountId: string | null,
  amount: Money,
  known: readonly Money[],
  date: LocalDate,
): Promise<Result<AccountLeg | null>> => {
  if (accountId === null) return ok(null);
  const account = await deps.accounts.find(accountId);
  if (account === null || account.currency === amount.currency.code) return ok(null);
  const currency = account.currency;
  const entered = known.find((money) => money.currency.code === currency);
  if (entered !== undefined) return ok({ amount: entered.minor, currency });
  return map(await convertedAt(deps, amount, currency, date), (leg) => ({ amount: leg.minor, currency }));
};

/**
 * P342 (S3): the leg of an account that pays or receives `amount` (in the movement's own currency) when a person records
 * it. Exchange is explicit: an account in the movement's currency moves by `amount` (no leg); one in another currency
 * moves by `accountAmount`, what it really moved, which must be in the account's currency (CurrencyMismatch), else by
 * `amount` at the date's rate, the suggestion (ExchangeRateRequired when no rate connects them that day). An
 * `accountAmount` on an account in the movement's currency must be `amount` itself, and one without an account has
 * nothing to move (both InvalidTransferLeg). The leg's positivity is the domain's.
 */
export const recordedLegOf = async (
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  accountId: string | null,
  amount: Money,
  accountAmount: Money | undefined,
  date: LocalDate,
): Promise<Result<AccountLeg | null>> => {
  if (accountId === null)
    return accountAmount === undefined ? ok(null) : err(domainError("InvalidTransferLeg"));
  const account = await deps.accounts.find(accountId);
  if (account === null) return ok(null);
  const currency = account.currency;
  if (accountAmount !== undefined && accountAmount.currency.code !== currency) {
    return err(domainError("CurrencyMismatch", { expected: currency, actual: accountAmount.currency.code }));
  }
  if (currency === amount.currency.code) {
    return accountAmount === undefined || accountAmount.minor === amount.minor
      ? ok(null)
      : err(domainError("InvalidTransferLeg"));
  }
  if (accountAmount !== undefined) return ok({ amount: accountAmount.minor, currency });
  return map(await convertedAt(deps, amount, currency, date), (leg) => ({ amount: leg.minor, currency }));
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
  const legOf = async (accountId: string | null, minor: bigint, knownHere: readonly Money[]) => {
    const moved = Money.ofMinor(minor, tx.currency);
    if (!moved.ok) return moved;
    return accountLegOf(deps, space, accountId, moved.value, knownHere, tx.date);
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
  if (tx.type === "TRANSFER" || tx.type === "ADJUSTMENT") {
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
