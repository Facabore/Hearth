import { domainError, err, Money, ok, type ExchangeRate, type LocalDate, type Result } from "@/shared/kernel";
import type { Expense, Payment, Transaction } from "./transaction";

/**
 * Ruling P336: an account moves from currency `from` to `to` at `rate` (1 `from` = `rate` `to`), which the person may
 * have typed; `accountSpaceId` is the space the account lives in, and `periodOpen` says whether a date of that space
 * is in an open plan period.
 */
export interface AccountConversion {
  readonly accountId: string;
  readonly accountSpaceId: string;
  readonly from: string;
  readonly to: string;
  readonly rate: ExchangeRate;
  readonly periodOpen: (date: LocalDate) => boolean;
}

/** `value` without the given fields, so a dropped leg or original reads as absent, never as undefined. */
const without = <T extends object>(value: T, fields: readonly string[]): T =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))) as T;

/** What `minor` of `from` is in `to` at the rate; a positive amount that rounds to nothing is refused. */
const converted = (minor: bigint, conversion: AccountConversion): Result<bigint> => {
  const money = Money.ofMinor(minor, conversion.from);
  if (!money.ok) return money;
  const result = money.value.convert(conversion.rate);
  if (!result.ok) return result;
  return result.value.minor > 0n
    ? ok(result.value.minor)
    : err(domainError("ConvertedAmountTooSmall", { amount: String(minor), currency: conversion.from }));
};

/** The account's side of a movement after the change: its leg, or none when it equals the movement's amount. */
const legFor = (amount: bigint, part: bigint, tx: Transaction, to: string) =>
  to === tx.currency && amount === part ? null : { amount, currency: to };

/**
 * Ruling P336: a movement keeps its amount in its space's currency, so shares, debts and plans never change, unless it
 * belongs to the account's own space, lies in an open period, is linked to no other movement, and the account is all it
 * moves: then its amount follows what the account moved.
 */
const follows = (tx: Transaction, conversion: AccountConversion): boolean => {
  if (tx.spaceId !== conversion.accountSpaceId || conversion.to !== tx.currency) return false;
  if (!conversion.periodOpen(tx.date)) return false;
  switch (tx.type) {
    case "INCOME":
    case "ADJUSTMENT":
      return true;
    case "EXPENSE":
      return tx.linkedTransactionId === undefined && tx.payments.length === 1 && tx.shares.length === 1;
    case "TRANSFER": {
      if (tx.linkedTransactionId !== undefined) return false;
      // The other account keeps what it moved only when it has its own leg; otherwise its amount is the movement's.
      return tx.sourceAccountId === conversion.accountId
        ? tx.destinationAmount !== undefined
        : tx.sourceAccountId !== null && tx.sourceAmount !== undefined;
    }
    case "SETTLEMENT":
      return false;
  }
};

/** The original entered in the account's old currency, or in the new one when the amount follows, goes with it. */
const withoutOriginalIn = <T extends Transaction>(tx: T, currencies: readonly string[]): T => {
  if (tx.originalCurrency === undefined || !currencies.includes(tx.originalCurrency)) return tx;
  return without(tx, ["originalAmount", "originalCurrency"]);
};

/** A side of a non-expense movement: its account, its leg, and the leg's field names. */
const SIDES = [
  { account: "sourceAccountId", amount: "sourceAmount", currency: "sourceCurrency" },
  { account: "destinationAccountId", amount: "destinationAmount", currency: "destinationCurrency" },
] as const;

/**
 * Ruling P336: `tx` after `conversion`, with what it moved in the account converted at the rate. A movement that does
 * not touch the account comes back unchanged.
 */
export const convertedForAccount = (tx: Transaction, conversion: AccountConversion): Result<Transaction> => {
  const follow = follows(tx, conversion);
  if (tx.type === "EXPENSE") return convertedExpense(tx, conversion, follow);
  let next: Record<string, unknown> = { ...tx };
  for (const side of SIDES) {
    if (
      !(side.account in tx) ||
      (tx as unknown as Record<string, unknown>)[side.account] !== conversion.accountId
    ) {
      continue;
    }
    const leg = (tx as unknown as Record<string, bigint | undefined>)[side.amount];
    const amount = converted(leg ?? tx.amount, conversion);
    if (!amount.ok) return amount;
    next = without(next, [side.amount, side.currency]);
    if (follow) {
      next.amount = amount.value;
    } else {
      const kept = legFor(amount.value, tx.amount, tx, conversion.to);
      if (kept !== null) next = { ...next, [side.amount]: kept.amount, [side.currency]: kept.currency };
    }
  }
  const result = next as unknown as Transaction;
  return ok(follow ? withoutOriginalIn(result, [conversion.from, conversion.to]) : result);
};

const convertedExpense = (
  tx: Expense,
  conversion: AccountConversion,
  follow: boolean,
): Result<Transaction> => {
  const payments: Payment[] = [];
  let amount = tx.amount;
  for (const payment of tx.payments) {
    if (payment.accountId !== conversion.accountId) {
      payments.push(payment);
      continue;
    }
    const moved = converted(payment.accountAmount ?? payment.amount, conversion);
    if (!moved.ok) return moved;
    const plain = without(payment, ["accountAmount", "accountCurrency"]);
    if (follow) {
      amount = moved.value;
      payments.push({ ...plain, amount: moved.value });
      continue;
    }
    const leg = legFor(moved.value, payment.amount, tx, conversion.to);
    payments.push(
      leg === null ? plain : { ...plain, accountAmount: leg.amount, accountCurrency: leg.currency },
    );
  }
  const shares = follow ? tx.shares.map((share) => ({ ...share, amount })) : tx.shares;
  const result: Expense = { ...tx, amount, payments, shares };
  return ok(follow ? withoutOriginalIn(result, [conversion.from, conversion.to]) : result);
};

/**
 * What `tx` moves account `accountId` by, signed as the balance counts it (HU-E2-04): its leg when it has one, else the
 * movement's amount; incomes and arrivals in, payments and departures out.
 */
export const accountMovement = (tx: Transaction, accountId: string): bigint => {
  if (tx.type === "EXPENSE") {
    return tx.payments
      .filter((p) => p.accountId === accountId)
      .reduce((sum, p) => sum - (p.accountAmount ?? p.amount), 0n);
  }
  let net = 0n;
  if (tx.destinationAccountId === accountId) net += tx.destinationAmount ?? tx.amount;
  if (tx.type !== "INCOME" && tx.sourceAccountId === accountId) net -= tx.sourceAmount ?? tx.amount;
  return net;
};
