import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/shared/infrastructure/db/client";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { TransactionRepository } from "../application/ports";
import type { Transaction } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";
import { loadTransactions, paymentRows, shareRows, transactionRow } from "./transaction-rows";

export class DrizzleTransactionRepository implements TransactionRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(transaction: Transaction): Promise<void> {
    const db = this.tm.executor();
    await db.insert(transactions).values(transactionRow(transaction));
    await this.insertParts(db, transaction);
  }

  async findById(
    spaceId: string,
    transactionId: string,
    includeDeleted = false,
  ): Promise<Transaction | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(transactionId)) return null;
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.spaceId, spaceId),
          includeDeleted ? undefined : isNull(transactions.deletedAt),
        ),
      );
    const [found] = await loadTransactions(db, rows);
    return found ?? null;
  }

  /** Compare-and-set on version: a concurrent writer that read the same version updates nothing. */
  async save(transaction: Transaction, expectedVersion: number): Promise<boolean> {
    const db = this.tm.executor();
    const row = transactionRow(transaction);
    const updated = await db
      .update(transactions)
      .set({
        description: transaction.description,
        date: transaction.date,
        occurredAt: transaction.occurredAt,
        timeZone: transaction.timeZone,
        categoryId: transaction.categoryId,
        amount: transaction.amount,
        // P186: an edit may move an income's or a transfer's accounts; an expense keeps both null (transactions_shape).
        sourceAccountId: row.sourceAccountId,
        destinationAccountId: row.destinationAccountId,
        updatedAt: transaction.updatedAt,
        deletedAt: transaction.deletedAt,
        version: expectedVersion + 1,
      })
      .where(and(eq(transactions.id, transaction.id), eq(transactions.version, expectedVersion)))
      .returning({ id: transactions.id });
    if (updated.length === 0) return false;
    if (transaction.type === "EXPENSE") {
      // D8: these rows hold the current version only; the audit keeps every earlier split (Task 0b).
      await db.delete(payments).where(eq(payments.transactionId, transaction.id));
      await db.delete(shares).where(eq(shares.transactionId, transaction.id));
      await this.insertParts(db, transaction);
    }
    return true;
  }

  private async insertParts(db: Executor, transaction: Transaction): Promise<void> {
    const paymentValues = paymentRows(transaction);
    if (paymentValues.length > 0) await db.insert(payments).values(paymentValues);
    const shareValues = shareRows(transaction);
    if (shareValues.length > 0) await db.insert(shares).values(shareValues);
  }
}
