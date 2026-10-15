import {
  and,
  asc,
  between,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate } from "@/shared/kernel";
import type {
  MemberMoneyTotals,
  TransactionFilter,
  TransactionPosition,
  TransactionQuery,
} from "../application/ports";
import type { Transaction } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";
import { loadTransactions } from "./transaction-rows";

// SUM(bigint) is numeric in PostgreSQL: read it as text and parse it as bigint, so sums never overflow or round.
const sumAsText = (column: AnyColumn) => sql<string>`sum(${column})::text`;

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

  /**
   * HU-E5-01, E5 balance rule: per-member sums over the live transactions of one space. Expenses count
   * only when members paid them (a fund-paid expense creates no debt, D5); transfers, fund contributions
   * included, never count. One statement, so every sum comes from the same snapshot and Σ net stays 0
   * under concurrent writes. Sorted by member id; `[]` for malformed ids.
   */
  async memberTotals(spaceId: string): Promise<MemberMoneyTotals[]> {
    if (!isUuid(spaceId)) return [];
    const db = this.tm.executor();
    type Field = "paid" | "consumed" | "settledOut" | "settledIn";
    // Same selection shape in every branch of the UNION ALL: member, field label, sum as text.
    const memberOf = (column: AnyColumn) => sql<string | null>`${column}`;
    const fundPayments = alias(payments, "fund_payments");
    const live = and(eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt));
    const memberPaid = and(
      live,
      eq(transactions.type, "EXPENSE"),
      notExists(
        db
          .select({ one: sql`1` })
          .from(fundPayments)
          .where(and(eq(fundPayments.transactionId, transactions.id), isNull(fundPayments.memberId))),
      ),
    );
    const settlements = and(live, eq(transactions.type, "SETTLEMENT"));
    const rows = await unionAll(
      db
        .select({
          memberId: memberOf(payments.memberId),
          field: sql<Field>`'paid'::text`,
          total: sumAsText(payments.amount),
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(memberPaid)
        .groupBy(payments.memberId),
      db
        .select({
          memberId: memberOf(shares.memberId),
          field: sql<Field>`'consumed'::text`,
          total: sumAsText(shares.amount),
        })
        .from(shares)
        .innerJoin(transactions, eq(transactions.id, shares.transactionId))
        .where(memberPaid)
        .groupBy(shares.memberId),
      db
        .select({
          memberId: memberOf(transactions.payerMemberId),
          field: sql<Field>`'settledOut'::text`,
          total: sumAsText(transactions.amount),
        })
        .from(transactions)
        .where(settlements)
        .groupBy(transactions.payerMemberId),
      db
        .select({
          memberId: memberOf(transactions.receivingMemberId),
          field: sql<Field>`'settledIn'::text`,
          total: sumAsText(transactions.amount),
        })
        .from(transactions)
        .where(settlements)
        .groupBy(transactions.receivingMemberId),
    );
    const totals = new Map<string, Record<Field, bigint>>();
    for (const row of rows) {
      if (row.memberId === null) continue;
      const sums = totals.get(row.memberId) ?? { paid: 0n, consumed: 0n, settledOut: 0n, settledIn: 0n };
      sums[row.field] += BigInt(row.total);
      totals.set(row.memberId, sums);
    }
    return [...totals.entries()]
      .map(([memberId, sums]) => ({ memberId, ...sums }))
      .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));
  }

  /** Spec 5.4, HU-E6-04: Σ live expenses of the space per category within [from, to], for budget lines (D7). */
  async expensesByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ categoryId: string; amount: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select({ categoryId: transactions.categoryId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          eq(transactions.type, "EXPENSE"),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(transactions.categoryId)
      .orderBy(asc(transactions.categoryId));
    return rows.flatMap((row) =>
      row.categoryId === null ? [] : [{ categoryId: row.categoryId, amount: BigInt(row.total) }],
    );
  }

  /**
   * Spec 5.4, HU-E6-03: Σ live transfers into each account within [from, to], for SAVINGS lines. Not scoped to a
   * space: a savings account lives in its owner's personal space while the line may belong to a shared space.
   */
  async transfersIntoAccounts(
    accountIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ accountId: string; amount: bigint }[]> {
    const ids = accountIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({ accountId: transactions.destinationAccountId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(
        and(
          eq(transactions.type, "TRANSFER"),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
          inArray(transactions.destinationAccountId, ids),
        ),
      )
      .groupBy(transactions.destinationAccountId)
      .orderBy(asc(transactions.destinationAccountId));
    return rows.flatMap((row) =>
      row.accountId === null ? [] : [{ accountId: row.accountId, amount: BigInt(row.total) }],
    );
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
