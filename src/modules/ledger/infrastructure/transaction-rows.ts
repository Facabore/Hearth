import { asc, inArray } from "drizzle-orm";
import type { Executor } from "@/shared/infrastructure/db/client";
import type { LocalDate } from "@/shared/kernel";
import type { Payment, Share, Transaction, TransactionId } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";

type TransactionRow = typeof transactions.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;
type ShareRow = typeof shares.$inferSelect;

export const transactionRow = (tx: Transaction): typeof transactions.$inferInsert => ({
  id: tx.id,
  spaceId: tx.spaceId,
  type: tx.type,
  description: tx.description,
  date: tx.date,
  categoryId: tx.categoryId,
  amount: tx.amount,
  currency: tx.currency,
  sourceAccountId: tx.type === "TRANSFER" ? tx.sourceAccountId : null,
  destinationAccountId: tx.type === "EXPENSE" ? null : tx.destinationAccountId,
  receivingMemberId: tx.type === "INCOME" ? tx.receivingMemberId : null,
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
    amount: row.amount,
    currency: row.currency,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    version: row.version,
  };
  switch (row.type) {
    case "EXPENSE":
      return {
        ...base,
        type: "EXPENSE",
        categoryId: row.categoryId!,
        payments: rowPayments.map(toPayment),
        shares: rowShares.map(toShare),
      };
    case "INCOME":
      return {
        ...base,
        type: "INCOME",
        categoryId: row.categoryId!,
        destinationAccountId: row.destinationAccountId!,
        receivingMemberId: row.receivingMemberId!,
      };
    case "TRANSFER":
      return {
        ...base,
        type: "TRANSFER",
        categoryId: null,
        sourceAccountId: row.sourceAccountId!,
        destinationAccountId: row.destinationAccountId!,
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
          .select()
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
