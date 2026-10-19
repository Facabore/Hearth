import {
  and,
  asc,
  between,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
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
// The same sum, negated: money leaving an account. `::` binds tighter than unary minus, so without the parentheses
// PostgreSQL would apply `-` to text and fail.
const negatedSumAsText = (column: AnyColumn) => sql<string>`(-sum(${column}))::text`;

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

  /**
   * HU-E2-04: incomes and transfers in, minus transfers out and payments out, per account. One statement, so every
   * account's figure comes from the same snapshot: a transfer that commits while the read runs shows both of its
   * legs or neither, and the totals built on these figures (HU-E2-07) never count one leg alone.
   */
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
    // Same selection shape in every branch of the UNION ALL: the account and its signed movement as text.
    const rows = await unionAll(
      db
        .select({ accountId: transactions.destinationAccountId, total: sumAsText(transactions.amount) })
        .from(transactions)
        .where(and(live, inArray(transactions.destinationAccountId, ids)))
        .groupBy(transactions.destinationAccountId),
      db
        .select({ accountId: transactions.sourceAccountId, total: negatedSumAsText(transactions.amount) })
        .from(transactions)
        .where(and(live, inArray(transactions.sourceAccountId, ids)))
        .groupBy(transactions.sourceAccountId),
      db
        .select({ accountId: payments.accountId, total: negatedSumAsText(payments.amount) })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(and(live, inArray(payments.accountId, ids)))
        .groupBy(payments.accountId),
    );
    for (const row of rows) {
      if (row.accountId !== null) net.set(row.accountId, (net.get(row.accountId) ?? 0n) + BigInt(row.total));
    }
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

  /**
   * HU-E7-02, spec 5.4: per category and member, Σ the member's payments and Σ their shares over the live expenses of
   * the space dated within [from, to]. A fund payment has no member, so it counts for nobody (D5). One statement, so
   * both sums come from one snapshot; sorted by category, then member; `[]` for malformed ids.
   */
  async memberSumsByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ categoryId: string; memberId: string; paid: bigint; consumed: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const db = this.tm.executor();
    type Field = "paid" | "consumed";
    // Same selection shape in both branches of the UNION ALL.
    const idOf = (column: AnyColumn) => sql<string | null>`${column}`;
    const expenses = and(
      eq(transactions.spaceId, spaceId),
      eq(transactions.type, "EXPENSE"),
      isNull(transactions.deletedAt),
      between(transactions.date, from, to),
    );
    const rows = await unionAll(
      db
        .select({
          categoryId: idOf(transactions.categoryId),
          memberId: idOf(payments.memberId),
          field: sql<Field>`'paid'::text`,
          total: sumAsText(payments.amount),
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(expenses)
        .groupBy(transactions.categoryId, payments.memberId),
      db
        .select({
          categoryId: idOf(transactions.categoryId),
          memberId: idOf(shares.memberId),
          field: sql<Field>`'consumed'::text`,
          total: sumAsText(shares.amount),
        })
        .from(shares)
        .innerJoin(transactions, eq(transactions.id, shares.transactionId))
        .where(expenses)
        .groupBy(transactions.categoryId, shares.memberId),
    );
    const sums = new Map<string, { categoryId: string; memberId: string; paid: bigint; consumed: bigint }>();
    for (const row of rows) {
      if (row.categoryId === null || row.memberId === null) continue;
      const key = `${row.categoryId}/${row.memberId}`;
      const entry = sums.get(key) ?? {
        categoryId: row.categoryId,
        memberId: row.memberId,
        paid: 0n,
        consumed: 0n,
      };
      entry[row.field] += BigInt(row.total);
      sums.set(key, entry);
    }
    return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry);
  }

  /**
   * HU-E7-03, spec 5.4: Σ the live fund contributions of the space (transfers with a contributing member, HU-E4-09)
   * dated within [from, to], per member, those from outside the app included; sorted by member; `[]` for malformed ids.
   */
  async fundContributionsByMember(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ memberId: string; amount: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select({ memberId: transactions.payerMemberId, total: sumAsText(transactions.amount) })
      .from(transactions)
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          eq(transactions.type, "TRANSFER"),
          // A contribution is a transfer with a contributing member (HU-E4-03 vs HU-E4-09); the flatMap below only narrows the type.
          isNotNull(transactions.payerMemberId),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(transactions.payerMemberId)
      .orderBy(asc(transactions.payerMemberId));
    return rows.flatMap((row) =>
      row.memberId === null ? [] : [{ memberId: row.memberId, amount: BigInt(row.total) }],
    );
  }

  /**
   * HU-E7-04, spec 5.4 (D11): Σ the shares of `memberIds`, one user's member rows, over live expenses dated within
   * [from, to], per space and category, whatever space recorded them; sorted by space, then category; `[]` without
   * well-formed ids.
   */
  async consumptionByCategory(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ spaceId: string; categoryId: string; amount: bigint }[]> {
    const ids = memberIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({
        spaceId: transactions.spaceId,
        categoryId: transactions.categoryId,
        total: sumAsText(shares.amount),
      })
      .from(shares)
      .innerJoin(transactions, eq(transactions.id, shares.transactionId))
      .where(
        and(
          inArray(shares.memberId, ids),
          // Defensive: only expenses carry shares today, so this never drops a row.
          eq(transactions.type, "EXPENSE"),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(transactions.spaceId, transactions.categoryId)
      .orderBy(asc(transactions.spaceId), asc(transactions.categoryId));
    return rows.flatMap((row) =>
      row.categoryId === null
        ? []
        : [{ spaceId: row.spaceId, categoryId: row.categoryId, amount: BigInt(row.total) }],
    );
  }

  /**
   * HU-E7-04, spec 5.4: what `memberIds` paid out within [from, to]: their payments of live expenses and their live
   * fund contributions, each with the part without an account ("outside the app": a guest's history before a claim).
   */
  async cashOut(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{
    payments: bigint;
    paymentsOutsideTheApp: bigint;
    fundContributions: bigint;
    contributionsOutsideTheApp: bigint;
  }> {
    const ids = memberIds.filter(isUuid);
    if (ids.length === 0) {
      return {
        payments: 0n,
        paymentsOutsideTheApp: 0n,
        fundContributions: 0n,
        contributionsOutsideTheApp: 0n,
      };
    }
    const db = this.tm.executor();
    const live = and(isNull(transactions.deletedAt), between(transactions.date, from, to));
    // One statement, so both sums come from one snapshot: each derived table is a single aggregate row.
    const paid = db
      .select({
        total: sql<string>`coalesce(sum(${payments.amount}), 0)::text`.as("paid_total"),
        outside:
          sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.accountId} is null), 0)::text`.as(
            "paid_outside",
          ),
      })
      .from(payments)
      .innerJoin(transactions, eq(transactions.id, payments.transactionId))
      .where(and(live, eq(transactions.type, "EXPENSE"), inArray(payments.memberId, ids)))
      .as("paid");
    const contributed = db
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`.as("contributed_total"),
        outside:
          sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.sourceAccountId} is null), 0)::text`.as(
            "contributed_outside",
          ),
      })
      .from(transactions)
      .where(and(live, eq(transactions.type, "TRANSFER"), inArray(transactions.payerMemberId, ids)))
      .as("contributed");
    const [row] = await db
      .select({
        payments: paid.total,
        paymentsOutside: paid.outside,
        contributions: contributed.total,
        contributionsOutside: contributed.outside,
      })
      .from(paid)
      .crossJoin(contributed);
    return {
      payments: BigInt(row?.payments ?? "0"),
      paymentsOutsideTheApp: BigInt(row?.paymentsOutside ?? "0"),
      fundContributions: BigInt(row?.contributions ?? "0"),
      contributionsOutsideTheApp: BigInt(row?.contributionsOutside ?? "0"),
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
