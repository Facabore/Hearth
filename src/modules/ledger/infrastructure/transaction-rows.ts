import { asc, getTableColumns, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/shared/infrastructure/db/client";
import type { LocalDate } from "@/shared/kernel";
import {
  linkedHalfOf,
  type Payment,
  type Share,
  type Transaction,
  type TransactionId,
} from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";

type TransactionRow = typeof transactions.$inferSelect;
/** A payment row with its account's currency, the currency of its leg (D29). */
type PaymentRow = typeof payments.$inferSelect & { readonly accountCurrency: string | null };
type ShareRow = typeof shares.$inferSelect;

/** The types that may move money out of a source account (design Q4: an adjustment out names its account there). */
const hasSource = (
  tx: Transaction,
): tx is Extract<Transaction, { type: "TRANSFER" | "SETTLEMENT" | "ADJUSTMENT" }> =>
  tx.type === "TRANSFER" || tx.type === "SETTLEMENT" || tx.type === "ADJUSTMENT";

/** Per-type columns; the transactions_shape check pins which ones each type sets. */
export const transactionRow = (tx: Transaction): typeof transactions.$inferInsert => ({
  id: tx.id,
  spaceId: tx.spaceId,
  type: tx.type,
  description: tx.description,
  date: tx.date,
  occurredAt: tx.occurredAt,
  timeZone: tx.timeZone,
  categoryId: tx.categoryId,
  amount: tx.amount,
  currency: tx.currency,
  // D29, slice MC3: null when the domain field is undefined (the original/leg equals the base amount), round-tripped.
  originalAmount: tx.originalAmount ?? null,
  originalCurrency: tx.originalCurrency ?? null,
  // D29, slice MC3: each account leg with its currency (its account's own); an expense's are on its payments.
  sourceAmount: hasSource(tx) ? (tx.sourceAmount ?? null) : null,
  destinationAmount: tx.type === "EXPENSE" ? null : (tx.destinationAmount ?? null),
  sourceCurrency: hasSource(tx) ? (tx.sourceCurrency ?? null) : null,
  destinationCurrency: tx.type === "EXPENSE" ? null : (tx.destinationCurrency ?? null),
  sourceAccountId: hasSource(tx) ? tx.sourceAccountId : null,
  destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
  receivingMemberId: tx.type === "INCOME" || tx.type === "SETTLEMENT" ? tx.receivingMemberId : null,
  payerMemberId: tx.type === "TRANSFER" || tx.type === "SETTLEMENT" ? tx.payerMemberId : null,
  // Ruling P322: written on every new settlement; only rows recorded before 0029 keep a null reason.
  settlementReason: tx.type === "SETTLEMENT" ? tx.reason : null,
  onBehalfOfMemberId: tx.type === "SETTLEMENT" ? tx.onBehalfOfMemberId : null,
  linkedTransactionId: linkedHalfOf(tx),
  createdBy: tx.createdBy,
  createdAt: tx.createdAt,
  updatedAt: tx.updatedAt,
  deletedAt: tx.deletedAt,
  version: tx.version,
});

export const paymentRows = (tx: Transaction): (typeof payments.$inferInsert)[] =>
  tx.type === "EXPENSE"
    ? tx.payments.map((p, position) => ({
        transactionId: tx.id,
        position,
        memberId: p.memberId,
        accountId: p.accountId,
        amount: p.amount,
        accountAmount: p.accountAmount ?? null,
      }))
    : [];

export const shareRows = (tx: Transaction): (typeof shares.$inferInsert)[] =>
  tx.type === "EXPENSE"
    ? tx.shares.map((s, position) => ({
        transactionId: tx.id,
        position,
        memberId: s.memberId,
        amount: s.amount,
        splitMethod: s.splitMethod,
      }))
    : [];

const toPayment = (row: PaymentRow): Payment => ({
  memberId: row.memberId,
  accountId: row.accountId,
  amount: row.amount,
  // D29, slice MC3: absent when the leg equals the base amount (null column), so the aggregate round-trips. Its currency
  // is the paying account's own, which is fixed once the account has movements.
  ...(row.accountAmount === null || row.accountCurrency === null
    ? {}
    : { accountAmount: row.accountAmount, accountCurrency: row.accountCurrency }),
});
const toShare = (row: ShareRow): Share => ({
  memberId: row.memberId,
  amount: row.amount,
  splitMethod: row.splitMethod,
});

/** Rebuilds the aggregate; the transactions_shape check guarantees the per-type columns are set. */
const toTransaction = (
  row: TransactionRow,
  rowPayments: readonly PaymentRow[],
  rowShares: readonly ShareRow[],
): Transaction => {
  const base = {
    id: row.id as TransactionId,
    spaceId: row.spaceId,
    description: row.description,
    date: row.date as LocalDate,
    occurredAt: row.occurredAt,
    timeZone: row.timeZone,
    amount: row.amount,
    currency: row.currency,
    // D29, slice MC3: present only when they differ from the base amount/currency (non-null columns).
    ...(row.originalAmount === null ? {} : { originalAmount: row.originalAmount }),
    ...(row.originalCurrency === null ? {} : { originalCurrency: row.originalCurrency }),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  };
  // D26: only the halves of an expense paid for the fund carry a link among expenses and transfers.
  const linked =
    row.linkedTransactionId === null ? {} : { linkedTransactionId: row.linkedTransactionId as TransactionId };
  switch (row.type) {
    case "EXPENSE":
      return {
        ...base,
        type: "EXPENSE",
        categoryId: row.categoryId!,
        payments: rowPayments.map(toPayment),
        shares: rowShares.map(toShare),
        ...linked,
      };
    case "INCOME":
      return {
        ...base,
        type: "INCOME",
        categoryId: row.categoryId!,
        destinationAccountId: row.destinationAccountId!,
        receivingMemberId: row.receivingMemberId!,
        // D29, slice MC3: the leg's currency; a row written before it was stored kept its original currency there.
        ...(row.destinationAmount === null
          ? {}
          : {
              destinationAmount: row.destinationAmount,
              destinationCurrency: row.destinationCurrency ?? row.originalCurrency ?? row.currency,
            }),
      };
    case "TRANSFER":
      return {
        ...base,
        type: "TRANSFER",
        categoryId: null,
        sourceAccountId: row.sourceAccountId,
        destinationAccountId: row.destinationAccountId!,
        payerMemberId: row.payerMemberId,
        ...(row.sourceAmount === null ? {} : { sourceAmount: row.sourceAmount }),
        ...(row.destinationAmount === null ? {} : { destinationAmount: row.destinationAmount }),
        // D29, slice MC3: a leg's currency round-trips with its amount (null column ↔ absent field).
        ...(row.sourceCurrency === null ? {} : { sourceCurrency: row.sourceCurrency }),
        ...(row.destinationCurrency === null ? {} : { destinationCurrency: row.destinationCurrency }),
        ...linked,
      };
    case "SETTLEMENT":
      return {
        ...base,
        type: "SETTLEMENT",
        categoryId: null,
        payerMemberId: row.payerMemberId!,
        receivingMemberId: row.receivingMemberId!,
        sourceAccountId: row.sourceAccountId,
        destinationAccountId: row.destinationAccountId,
        // Ruling P322: a settlement recorded before 0029 has no reason; every one of them was a PAYMENT.
        reason: row.settlementReason ?? "PAYMENT",
        onBehalfOfMemberId: row.onBehalfOfMemberId,
        linkedTransactionId: row.linkedTransactionId as TransactionId | null,
        // D29, slice MC3: a leg's currency round-trips with its amount (null column ↔ absent field).
        ...(row.sourceAmount === null || row.sourceCurrency === null
          ? {}
          : { sourceAmount: row.sourceAmount, sourceCurrency: row.sourceCurrency }),
        ...(row.destinationAmount === null || row.destinationCurrency === null
          ? {}
          : { destinationAmount: row.destinationAmount, destinationCurrency: row.destinationCurrency }),
      };
    // Design Q4: one account, on the side the money moved; its leg round-trips with its currency, as a transfer's.
    case "ADJUSTMENT":
      return {
        ...base,
        type: "ADJUSTMENT",
        categoryId: null,
        sourceAccountId: row.sourceAccountId,
        destinationAccountId: row.destinationAccountId,
        ...(row.sourceAmount === null || row.sourceCurrency === null
          ? {}
          : { sourceAmount: row.sourceAmount, sourceCurrency: row.sourceCurrency }),
        ...(row.destinationAmount === null || row.destinationCurrency === null
          ? {}
          : { destinationAmount: row.destinationAmount, destinationCurrency: row.destinationCurrency }),
      };
  }
};

/** Loads the payments and shares of `rows` with two queries and keeps the rows' order. */
export const loadTransactions = async (
  db: Executor,
  rows: readonly TransactionRow[],
): Promise<Transaction[]> => {
  const expenseIds = rows.filter((r) => r.type === "EXPENSE").map((r) => r.id);
  const allPayments: PaymentRow[] =
    expenseIds.length === 0
      ? []
      : await db
          .select({
            ...getTableColumns(payments),
            // D29: the paying account's own currency, its leg's; read by name, as the accounts module owns the table.
            accountCurrency: sql<
              string | null
            >`(SELECT a.currency FROM accounts a WHERE a.id = ${payments.accountId})`,
          })
          .from(payments)
          .where(inArray(payments.transactionId, expenseIds))
          .orderBy(asc(payments.position));
  const allShares: ShareRow[] =
    expenseIds.length === 0
      ? []
      : await db
          .select()
          .from(shares)
          .where(inArray(shares.transactionId, expenseIds))
          .orderBy(asc(shares.position));
  return rows.map((row) =>
    toTransaction(
      row,
      allPayments.filter((p) => p.transactionId === row.id),
      allShares.filter((s) => s.transactionId === row.id),
    ),
  );
};
