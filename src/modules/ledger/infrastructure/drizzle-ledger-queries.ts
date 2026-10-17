import {
  and,
  asc,
  between,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  lte,
  notExists,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate } from "@/shared/kernel";
import type {
  BalanceMovement,
  HistoryRange,
  MemberBalanceHistory,
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

// HU-E4-14, ruling P43: untimed rows sort as the earliest time of their day, so they come last in DESC order.
// The cursor round-trips only because writers store millisecond instants: never write occurred_at with now(), defaultNow() or SQL.
const listTime = sql`coalesce(${transactions.occurredAt}, '-infinity'::timestamptz)`;

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
            : sql`(${transactions.date}, ${listTime}, ${transactions.createdAt}, ${transactions.id}) < (${after.date}::date, ${after.occurredAt?.toISOString() ?? "-infinity"}::timestamptz, ${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(transactions.date), desc(listTime), desc(transactions.createdAt), desc(transactions.id))
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

  /**
   * HU-E5-04 (E5 balance rule, D7): one member's balance-affecting movements in one space with a window function's
   * running balance over every earlier movement: live member-paid expenses they paid for or share (paid − share;
   * fund-paid expenses create no debt, D5) and settlements they paid (+) or received (−), in date, creation and id
   * order, through `to`. The statement itself keeps only the last movement before `from` and flags it `before_range`:
   * its balance is the opening, and the application only splits it from the entries, so the opening and the entries
   * come from one statement and one snapshot. Malformed ids answer an empty history.
   */
  async memberHistory(spaceId: string, memberId: string, range: HistoryRange): Promise<MemberBalanceHistory> {
    if (!isUuid(spaceId) || !isUuid(memberId)) return { opening: 0n, entries: [] };
    interface HistoryRow {
      readonly id: string;
      readonly date: string;
      readonly type: "EXPENSE" | "SETTLEMENT";
      readonly description: string;
      readonly change: string;
      readonly balance: string;
      /** The last movement before `from`, whose balance is the opening; false for every entry. */
      readonly before_range: boolean;
    }
    const { rows } = await this.tm.executor().execute(sql`
      WITH movements AS (
        SELECT t.id, t.date, t.created_at, t.type, t.description,
          coalesce((SELECT sum(p.amount) FROM ${payments} p WHERE p.transaction_id = t.id AND p.member_id = ${memberId}), 0)
            - coalesce((SELECT sum(s.amount) FROM ${shares} s WHERE s.transaction_id = t.id AND s.member_id = ${memberId}), 0)
            AS change
        FROM ${transactions} t
        WHERE t.space_id = ${spaceId} AND t.deleted_at IS NULL AND t.type = 'EXPENSE'
          AND NOT EXISTS (SELECT 1 FROM ${payments} f WHERE f.transaction_id = t.id AND f.member_id IS NULL)
        UNION ALL
        SELECT t.id, t.date, t.created_at, t.type, t.description,
          CASE WHEN t.payer_member_id = ${memberId} THEN t.amount ELSE -t.amount END
        FROM ${transactions} t
        WHERE t.space_id = ${spaceId} AND t.deleted_at IS NULL AND t.type = 'SETTLEMENT'
          AND ${memberId} IN (t.payer_member_id, t.receiving_member_id)
      ), running AS (
        SELECT id, date, created_at, type, description, change,
          sum(change) OVER (ORDER BY date, created_at, id) AS balance,
          lead(date) OVER (ORDER BY date, created_at, id) AS next_date
        FROM movements
        WHERE change <> 0 AND (${range.to}::date IS NULL OR date <= ${range.to}::date)
      )
      SELECT id, date::text AS date, type, description, change::text AS change, balance::text AS balance,
        coalesce(date < ${range.from}::date, false) AS before_range
      FROM running
      WHERE ${range.from}::date IS NULL OR date >= ${range.from}::date
        OR next_date IS NULL OR next_date >= ${range.from}::date
      ORDER BY running.date, running.created_at, running.id`);
    const history = rows as unknown as HistoryRow[];
    const opening = history.find((row) => row.before_range);
    return {
      opening: opening === undefined ? 0n : BigInt(opening.balance),
      entries: history
        .filter((row) => !row.before_range)
        .map((row): BalanceMovement => ({
          transactionId: row.id,
          type: row.type,
          date: row.date as LocalDate,
          description: row.description,
          change: BigInt(row.change),
          balance: BigInt(row.balance),
        })),
    };
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
