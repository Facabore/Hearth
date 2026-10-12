import { and, between, desc, eq, exists, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate } from "@/shared/kernel";
import type { TransactionFilter, TransactionPosition, TransactionQuery } from "../application/ports";
import type { Transaction } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";
import { loadTransactions } from "./transaction-rows";

// SUM(bigint) is numeric in PostgreSQL: read it as text and parse it as bigint, so sums never overflow or round.
const sumAsText = (column: typeof transactions.amount | typeof payments.amount) =>
  sql<string>`sum(${column})::text`;

/** Read side of the ledger, computed on read (D7): the monthly list, totals, account movements and references. */
export class DrizzleLedgerQueries implements TransactionQuery {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async list(
    filter: TransactionFilter,
    after: TransactionPosition | null,
    limit: number,
  ): Promise<Transaction[]> {
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          this.matching(filter),
          after === null
            ? undefined
            : or(
                lt(transactions.date, after.date),
                and(eq(transactions.date, after.date), lt(transactions.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(limit);
    return loadTransactions(db, rows);
  }

  async totals(filter: TransactionFilter): Promise<{ expenses: bigint; income: bigint }> {
    const [row] = await this.tm
      .executor()
      .select({
        expenses: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'EXPENSE'), 0)::text`,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'INCOME'), 0)::text`,
      })
      .from(transactions)
      .where(this.matching(filter));
    return { expenses: BigInt(row?.expenses ?? "0"), income: BigInt(row?.income ?? "0") };
  }

  /** HU-E2-04: incomes and transfers in, minus transfers out and payments out, per account. */
  async netMovements(
    accountIds: readonly string[],
    asOf: LocalDate | null,
  ): Promise<ReadonlyMap<string, bigint>> {
    const ids = accountIds.filter(isUuid);
    const net = new Map<string, bigint>();
    if (ids.length === 0) return net;
    const db = this.tm.executor();
    const live = and(
      isNull(transactions.deletedAt),
      asOf === null ? undefined : lte(transactions.date, asOf),
    );
    const incoming = await db
      .select({ accountId: transactions.destinationAccountId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(and(live, inArray(transactions.destinationAccountId, ids)))
      .groupBy(transactions.destinationAccountId);
    const outgoing = await db
      .select({ accountId: transactions.sourceAccountId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(and(live, inArray(transactions.sourceAccountId, ids)))
      .groupBy(transactions.sourceAccountId);
    const paid = await db
      .select({ accountId: payments.accountId, total: sumAsText(payments.amount) })
      .from(payments)
      .innerJoin(transactions, eq(transactions.id, payments.transactionId))
      .where(and(live, inArray(payments.accountId, ids)))
      .groupBy(payments.accountId);
    const add = (accountId: string | null, delta: bigint) => {
      if (accountId !== null) net.set(accountId, (net.get(accountId) ?? 0n) + delta);
    };
    for (const row of incoming) add(row.accountId, BigInt(row.total));
    for (const row of outgoing) add(row.accountId, -BigInt(row.total));
    for (const row of paid) add(row.accountId, -BigInt(row.total));
    return net;
  }

  /** HU-E3-03: soft-deleted transactions still reference their category (D8). */
  async isCategoryReferenced(categoryId: string): Promise<boolean> {
    if (!isUuid(categoryId)) return false;
    const rows = await this.tm
      .executor()
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.categoryId, categoryId))
      .limit(1);
    return rows.length > 0;
  }

  async hasTransactions(spaceId: string): Promise<boolean> {
    if (!isUuid(spaceId)) return false;
    const rows = await this.tm
      .executor()
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.spaceId, spaceId))
      .limit(1);
    return rows.length > 0;
  }

  private matching(f: TransactionFilter) {
    const db = this.tm.executor();
    return and(
      eq(transactions.spaceId, f.spaceId),
      isNull(transactions.deletedAt),
      between(transactions.date, f.from, f.to),
      f.type === undefined ? undefined : eq(transactions.type, f.type),
      f.categoryIds === undefined || f.categoryIds.length === 0
        ? undefined
        : inArray(transactions.categoryId, [...f.categoryIds]),
      f.payerMemberId === undefined
        ? undefined
        : exists(
            db
              .select({ one: sql`1` })
              .from(payments)
              .where(
                and(eq(payments.transactionId, transactions.id), eq(payments.memberId, f.payerMemberId)),
              ),
          ),
      f.participantMemberId === undefined
        ? undefined
        : exists(
            db
              .select({ one: sql`1` })
              .from(shares)
              .where(
                and(eq(shares.transactionId, transactions.id), eq(shares.memberId, f.participantMemberId)),
              ),
          ),
    );
  }
}
