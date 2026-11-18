import {
  and,
  asc,
  between,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { alias, unionAll } from "drizzle-orm/pg-core";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, Money, type LocalDate } from "@/shared/kernel";
import type { AccountUsageQuery, AccountUse, CategoryAccount } from "../application/get-account-usage";
import type { RecentQuery } from "../application/list-my-activity";
import type {
  BalanceMovement,
  HistoryRange,
  Involving,
  LastMovementQuery,
  MemberBalanceHistory,
  MemberMoneyTotals,
  SpaceDebtMovements,
  SpaceLastMovement,
  TransactionFilter,
  TransactionPosition,
  TransactionQuery,
  TransactionsAcrossFilter,
  TransactionsAcrossQuery,
} from "../application/ports";
import type { SettlementReason, Transaction } from "../domain/transaction";
import { payments, shares, transactions } from "./ledger.schema";
import { loadTransactions } from "./transaction-rows";

// SUM(bigint) is numeric in PostgreSQL: read it as text and parse it as bigint, so sums never overflow or round.
const sumAsText = (column: AnyColumn) => sql<string>`sum(${column})::text`;
// D29, slice MC3: an account's balance is in its own currency, so its side sums the leg amount in that currency,
// falling back to the base `amount` when the leg is null (the leg equals the base). `::` binds tighter than unary
// minus, so the negated form needs the parentheses. Behaviour-identical while every leg is null, which it is until a
// later slice records in another currency.
const legSumAsText = (leg: AnyColumn, base: AnyColumn) => sql<string>`sum(coalesce(${leg}, ${base}))::text`;
const negatedLegSumAsText = (leg: AnyColumn, base: AnyColumn) =>
  sql<string>`(-sum(coalesce(${leg}, ${base})))::text`;

/**
 * Ruling P342 (S7, owner: "Contar lo que pagó la cuenta"): the currency a plan's or a report's sums count in: `currency`
 * when given, else the space's own. The spaces table by name, as `memberHistory` reads it (ADR 0001).
 */
const countedCurrency = (currency: string | undefined, spaceId: string | AnyColumn): SQL =>
  currency === undefined
    ? sql`(SELECT s.currency FROM spaces s WHERE s.id = ${spaceId})`
    : sql`${currency}::text`;

/** Ruling P342 (S7): `currency` when given, else the receiving account's own (accounts table by name). */
const intoCurrency = (currency: string | undefined): SQL =>
  currency === undefined
    ? sql`(SELECT a.currency FROM accounts a WHERE a.id = ${transactions.destinationAccountId})`
    : sql`${currency}::text`;

/**
 * Ruling P342 (S7): what an expense's payments moved from accounts in `c` when the expense is in another currency: the
 * legs in `c` (an account leg is stored exactly when the account's currency differs from the movement's). The accounts
 * table by name, as transaction-rows.ts reads it.
 */
const paymentLegsIn = (c: SQL) =>
  sql`(SELECT sum(p.account_amount) FROM ${payments} p JOIN accounts a ON a.id = p.account_id
    WHERE p.transaction_id = ${transactions.id} AND p.account_amount IS NOT NULL AND a.currency = ${c})`;

/**
 * Ruling P342 (S7, owner: "Contar lo que pagó la cuenta"): a movement's amount as a sum in `c` counts it until plans
 * count several currencies (T6). One in `c` counts its amount; one in another currency counts its account leg in `c`:
 * what the paying accounts moved (an expense's payments, a transfer's source) or, failing that, what the receiving
 * account got (an income's or a transfer's destination). One without a leg in `c` counts nothing yet (null).
 */
const countedIn = (c: SQL) =>
  sql`(CASE WHEN ${transactions.currency} = ${c} THEN ${transactions.amount}
    WHEN ${transactions.type} = 'EXPENSE' THEN ${paymentLegsIn(c)}
    WHEN ${transactions.sourceAmount} IS NOT NULL AND ${transactions.sourceCurrency} = ${c} THEN ${transactions.sourceAmount}
    WHEN ${transactions.destinationAmount} IS NOT NULL AND ${transactions.destinationCurrency} = ${c}
      THEN ${transactions.destinationAmount}
  END)`;

/** Ruling P342 (S7): one payment as a sum in `c` counts it: its amount in `c`, else its account leg in `c`, else null. */
const paymentCountedIn = (c: SQL) =>
  sql`(CASE WHEN ${transactions.currency} = ${c} THEN ${payments.amount}
    WHEN ${payments.accountAmount} IS NOT NULL AND (SELECT a.currency FROM accounts a WHERE a.id = ${payments.accountId}) = ${c}
      THEN ${payments.accountAmount}
  END)`;

/** Σ of a counted amount as text, null when nothing counted. */
const countedSumAsText = (amount: SQL) => sql<string | null>`sum(${amount})::text`;

/** Ruling P342: what members paid out in one movement currency (`cashOut`). */
interface CashOutByCurrency {
  readonly currency: string;
  readonly payments: bigint;
  readonly paymentsOutsideTheApp: bigint;
  readonly fundContributions: bigint;
  readonly contributionsOutsideTheApp: bigint;
}

/** A member's part of an expense in another currency, as `foreignSharesIn` allocates it. */
interface CountedShare {
  readonly spaceId: string;
  readonly categoryId: string | null;
  readonly memberId: string;
  readonly amount: bigint;
}

// HU-E4-14, ruling P43: untimed rows sort as the earliest time of their day, so they come last in DESC order.
// The cursor round-trips only because writers store millisecond instants: never write occurred_at with now(), defaultNow() or SQL.
const listTime = sql`coalesce(${transactions.occurredAt}, '-infinity'::timestamptz)`;

/** Ruling P43: the list order, newest first. */
const listOrder = [
  desc(transactions.date),
  desc(listTime),
  desc(transactions.createdAt),
  desc(transactions.id),
] as const;

/** Ruling P43: the rows strictly after `after` in the list order; no condition for the first page. */
const pastPosition = (after: TransactionPosition | null) =>
  after === null
    ? undefined
    : sql`(${transactions.date}, ${listTime}, ${transactions.createdAt}, ${transactions.id}) < (${after.date}::date, ${after.occurredAt?.toISOString() ?? "-infinity"}::timestamptz, ${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`;

/** Inclusive dates, as `between` reads them. */
interface DateRange {
  readonly start: LocalDate;
  readonly end: LocalDate;
}

/** `(i, start, end)` rows for a VALUES list, i being each range's index. */
const rangeRows = (ranges: readonly DateRange[]) =>
  sql.join(
    ranges.map((range, i) => sql`(${i}::integer, ${range.start}::date, ${range.end}::date)`),
    sql`, `,
  );

/** Ruling P277: `%`, `_` and the escape character itself match only themselves in a LIKE pattern. */
/** Ruling P342: per-member rows by member id, then currency. */
const byMemberThenCurrency = (a: MemberMoneyTotals, b: MemberMoneyTotals) =>
  a.memberId !== b.memberId
    ? a.memberId < b.memberId
      ? -1
      : 1
    : a.currency < b.currency
      ? -1
      : a.currency > b.currency
        ? 1
        : 0;
const literalLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Read side of the ledger, computed on read (D7): the monthly list, totals, account movements and references. */
export class DrizzleLedgerQueries
  implements TransactionQuery, TransactionsAcrossQuery, LastMovementQuery, AccountUsageQuery
{
  constructor(private readonly tm: DrizzleTransactionManager) {}

  /**
   * Ruling P337 (#334): one statement over the live movements dated `from` or later that moved money out of or into an
   * active account `userId` owns: an expense's payments, and the source or destination of every other type but an
   * adjustment. A movement counts once per account, however many of its legs use it.
   */
  async accountUsage(
    userId: string,
    from: LocalDate,
  ): Promise<{ accounts: AccountUse[]; categories: CategoryAccount[] }> {
    const { rows } = await this.tm.executor().execute<{
      kind: "account" | "category";
      account_id: string;
      category_id: string | null;
      uses: number;
      last_used_on: string;
    }>(sql`
      WITH mine AS (
        -- The accounts table by name, as transaction-rows.ts reads it: the ledger imports no other module's schema (ADR 0001).
        SELECT a.id FROM accounts a WHERE a.owner_user_id = ${userId} AND a.archived_at IS NULL
      ), legs AS (
        SELECT t.id, p.account_id, t.date, t.type, t.category_id,
          coalesce(t.occurred_at, '-infinity'::timestamptz) AS at, t.created_at
        FROM ${payments} p JOIN ${transactions} t ON t.id = p.transaction_id
        WHERE p.account_id IN (SELECT id FROM mine) AND t.deleted_at IS NULL AND t.date >= ${from}
        UNION
        SELECT t.id, t.source_account_id, t.date, t.type, t.category_id,
          coalesce(t.occurred_at, '-infinity'::timestamptz), t.created_at
        FROM ${transactions} t
        WHERE t.source_account_id IN (SELECT id FROM mine) AND t.type <> 'ADJUSTMENT'
          AND t.deleted_at IS NULL AND t.date >= ${from}
        UNION
        SELECT t.id, t.destination_account_id, t.date, t.type, t.category_id,
          coalesce(t.occurred_at, '-infinity'::timestamptz), t.created_at
        FROM ${transactions} t
        WHERE t.destination_account_id IN (SELECT id FROM mine) AND t.type <> 'ADJUSTMENT'
          AND t.deleted_at IS NULL AND t.date >= ${from}
      )
      SELECT 'account' AS kind, account_id, NULL::uuid AS category_id, count(DISTINCT id)::int AS uses,
        max(date)::text AS last_used_on
      FROM legs GROUP BY account_id
      UNION ALL
      SELECT * FROM (
        SELECT DISTINCT ON (category_id) 'category', account_id, category_id, 0, date::text
        FROM legs WHERE type = 'EXPENSE'
        ORDER BY category_id, date DESC, at DESC, created_at DESC, id DESC
      ) latest
    `);
    return {
      accounts: rows
        .filter((row) => row.kind === "account")
        .map((row) => ({
          accountId: row.account_id,
          uses: Number(row.uses),
          lastUsedOn: row.last_used_on as LocalDate,
        })),
      categories: rows.flatMap((row) =>
        row.kind === "category" && row.category_id !== null
          ? [{ categoryId: row.category_id, accountId: row.account_id }]
          : [],
      ),
    };
  }

  async list(
    filter: TransactionFilter,
    after: TransactionPosition | null,
    limit: number,
  ): Promise<Transaction[]> {
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(and(this.matching(filter), pastPosition(after)))
      .orderBy(...listOrder)
      .limit(limit);
    return loadTransactions(db, rows);
  }

  /** Ruling P319: `list` over several spaces in one order; `[]` without valid space ids. */
  async listAcross(
    filter: TransactionsAcrossFilter,
    after: TransactionPosition | null,
    limit: number,
  ): Promise<Transaction[]> {
    const spaceIds = filter.spaceIds.filter(isUuid);
    if (spaceIds.length === 0) return [];
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          this.matchingIn(inArray(transactions.spaceId, spaceIds), filter),
          this.involving(filter.involving),
          pastPosition(after),
        ),
      )
      .orderBy(...listOrder)
      .limit(limit);
    return loadTransactions(db, rows);
  }

  /**
   * Ruling P319: the members' shares of the matching expenses and the matching incomes they received, in one
   * statement. Only an expense joins its members' shares, so every income is read once.
   */
  async memberTotalsAcross(
    filter: TransactionsAcrossFilter,
    memberIds: readonly string[],
    currency?: string,
  ): Promise<{ share: bigint; income: bigint }> {
    const spaceIds = filter.spaceIds.filter(isUuid);
    const members = memberIds.filter(isUuid);
    if (spaceIds.length === 0 || members.length === 0) return { share: 0n, income: 0n };
    // Ruling P342 (S7): counted in `currency`, else in each movement's space's own.
    const c = countedCurrency(currency, transactions.spaceId);
    const where = and(
      this.matchingIn(inArray(transactions.spaceId, spaceIds), filter),
      this.involving(filter.involving),
    );
    // Aliased, so the filter's own subqueries on `shares` never read the joined rows.
    const theirs = alias(shares, "their_shares");
    const [row] = await this.tm
      .executor()
      .select({
        share: sql<string>`coalesce(sum(${theirs.amount}) filter (where ${transactions.currency} = ${c}), 0)::text`,
        income: sql<string>`coalesce(sum(${countedIn(c)}) filter (where ${transactions.type} = 'INCOME' and ${inArray(transactions.receivingMemberId, members)}), 0)::text`,
      })
      .from(transactions)
      .leftJoin(
        theirs,
        and(
          eq(theirs.transactionId, transactions.id),
          eq(transactions.type, "EXPENSE"),
          inArray(theirs.memberId, members),
        ),
      )
      .where(where);
    const foreign = (await this.foreignSharesIn(c, where)).filter((part) => members.includes(part.memberId));
    return {
      share: BigInt(row?.share ?? "0") + foreign.reduce((sum, part) => sum + part.amount, 0n),
      income: BigInt(row?.income ?? "0"),
    };
  }

  /**
   * Ruling P342 (S7): the members' parts of the live expenses matching `where` that are in another currency than `c` but
   * were paid from accounts in `c`. What those accounts moved is allocated over the expense's shares in proportion to
   * them, as `Money.allocate` splits (largest remainder, ties to the earlier share), so the parts sum to what is counted
   * for the expense and a plan's consumption agrees with its spending. An expense with no leg in `c` has no parts.
   */
  private async foreignSharesIn(c: SQL, where: SQL | undefined): Promise<CountedShare[]> {
    const every = alias(shares, "every_share");
    const rows = await this.tm
      .executor()
      .select({
        id: transactions.id,
        spaceId: transactions.spaceId,
        categoryId: transactions.categoryId,
        currency: sql<string>`${c}`,
        counted: sql<string>`${paymentLegsIn(c)}::text`,
        memberId: every.memberId,
        amount: every.amount,
      })
      .from(transactions)
      .innerJoin(every, eq(every.transactionId, transactions.id))
      .where(
        and(
          where,
          eq(transactions.type, "EXPENSE"),
          sql`${transactions.currency} <> ${c}`,
          sql`${paymentLegsIn(c)} > 0`,
        ),
      )
      .orderBy(transactions.id, every.position);
    const byExpense = new Map<string, (typeof rows)[number][]>();
    for (const row of rows) byExpense.set(row.id, [...(byExpense.get(row.id) ?? []), row]);
    return [...byExpense.values()].flatMap((parts) => {
      const [first] = parts as [(typeof rows)[number]];
      const money = Money.ofMinor(BigInt(first.counted), first.currency);
      const split = money.ok ? money.value.allocate(parts.map((part) => part.amount)) : money;
      // A broken invariant (an unknown currency, shares that do not weigh): loud, never a silent zero.
      if (!split.ok) throw new Error(`Cannot allocate expense ${first.id}: ${split.error.code}`);
      return parts.map((part, i) => ({
        spaceId: part.spaceId,
        categoryId: part.categoryId,
        memberId: part.memberId,
        amount: split.value[i]!.minor,
      }));
    });
  }

  /**
   * Ruling P306: the live transactions of several spaces from `from`, in `list`'s order, that involve one of the member
   * rows (ruling P329); `[]` without valid ids.
   */
  async recentIn({ spaceIds, from, to, involving }: RecentQuery, limit: number): Promise<Transaction[]> {
    const ids = spaceIds.filter(isUuid);
    if (ids.length === 0) return [];
    const db = this.tm.executor();
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          inArray(transactions.spaceId, ids),
          isNull(transactions.deletedAt),
          gte(transactions.date, from),
          to === undefined ? undefined : lte(transactions.date, to),
          this.involving({ memberIds: involving, alwaysIn: [] }),
        ),
      )
      .orderBy(...listOrder)
      .limit(limit);
    return loadTransactions(db, rows);
  }

  /** Ruling P338: one row per space with a live transaction, its newest in `list`'s order (DISTINCT ON keeps the first). */
  async lastMovementsIn(spaceIds: readonly string[]): Promise<SpaceLastMovement[]> {
    const ids = spaceIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .selectDistinctOn([transactions.spaceId], {
        spaceId: transactions.spaceId,
        transactionId: transactions.id,
        date: transactions.date,
        description: transactions.description,
        type: transactions.type,
      })
      .from(transactions)
      .where(and(inArray(transactions.spaceId, ids), isNull(transactions.deletedAt)))
      .orderBy(transactions.spaceId, ...listOrder);
    // A date column read in string mode is an ISO calendar date.
    return rows.map((row) => ({ ...row, date: row.date as LocalDate }));
  }

  /** Ruling P342 (S7): counted in `currency`, the space's own when absent (`countedIn`). */
  async totals(filter: TransactionFilter, currency?: string): Promise<{ expenses: bigint; income: bigint }> {
    const counted = countedIn(countedCurrency(currency, filter.spaceId));
    const [row] = await this.tm
      .executor()
      .select({
        expenses: sql<string>`coalesce(sum(${counted}) filter (where ${transactions.type} = 'EXPENSE'), 0)::text`,
        income: sql<string>`coalesce(sum(${counted}) filter (where ${transactions.type} = 'INCOME'), 0)::text`,
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
        .select({
          accountId: transactions.destinationAccountId,
          total: legSumAsText(transactions.destinationAmount, transactions.amount),
        })
        .from(transactions)
        .where(and(live, inArray(transactions.destinationAccountId, ids)))
        .groupBy(transactions.destinationAccountId),
      db
        .select({
          accountId: transactions.sourceAccountId,
          total: negatedLegSumAsText(transactions.sourceAmount, transactions.amount),
        })
        .from(transactions)
        .where(and(live, inArray(transactions.sourceAccountId, ids)))
        .groupBy(transactions.sourceAccountId),
      db
        .select({
          accountId: payments.accountId,
          total: negatedLegSumAsText(payments.accountAmount, payments.amount),
        })
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
   * under concurrent writes. Ruling P342 (S4): one row per member and currency, the movements' own, never converted.
   * Sorted by member id, then currency; `[]` for malformed ids.
   */
  async memberTotals(spaceId: string): Promise<MemberMoneyTotals[]> {
    if (!isUuid(spaceId)) return [];
    const db = this.tm.executor();
    type Field = "paid" | "consumed" | "settledOut" | "settledIn";
    // Same selection shape in every branch of the UNION ALL: member, currency, field label, sum as text.
    const memberOf = (column: AnyColumn) => sql<string | null>`${column}`;
    const currency = sql<string>`${transactions.currency}`;
    const { memberPaid, settlements } = this.debtFilters(spaceId);
    const rows = await unionAll(
      db
        .select({
          memberId: memberOf(payments.memberId),
          currency,
          field: sql<Field>`'paid'::text`,
          total: sumAsText(payments.amount),
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(memberPaid)
        .groupBy(payments.memberId, transactions.currency),
      db
        .select({
          memberId: memberOf(shares.memberId),
          currency,
          field: sql<Field>`'consumed'::text`,
          total: sumAsText(shares.amount),
        })
        .from(shares)
        .innerJoin(transactions, eq(transactions.id, shares.transactionId))
        .where(memberPaid)
        .groupBy(shares.memberId, transactions.currency),
      db
        .select({
          memberId: memberOf(transactions.payerMemberId),
          currency,
          field: sql<Field>`'settledOut'::text`,
          total: sumAsText(transactions.amount),
        })
        .from(transactions)
        .where(settlements)
        .groupBy(transactions.payerMemberId, transactions.currency),
      db
        .select({
          memberId: memberOf(transactions.receivingMemberId),
          currency,
          field: sql<Field>`'settledIn'::text`,
          total: sumAsText(transactions.amount),
        })
        .from(transactions)
        .where(settlements)
        .groupBy(transactions.receivingMemberId, transactions.currency),
    );
    const totals = new Map<string, MemberMoneyTotals>();
    for (const row of rows) {
      if (row.memberId === null) continue;
      const key = `${row.memberId} ${row.currency}`;
      const sums = totals.get(key) ?? {
        memberId: row.memberId,
        currency: row.currency,
        paid: 0n,
        consumed: 0n,
        settledOut: 0n,
        settledIn: 0n,
      };
      totals.set(key, { ...sums, [row.field]: sums[row.field] + BigInt(row.total) });
    }
    return [...totals.values()].sort(byMemberThenCurrency);
  }

  /**
   * Ruling P323: the live member-paid expenses of one space with their payments and shares in position order, and its
   * live settlements, in one statement so they all come from the same snapshot. The same rows `memberTotals` sums:
   * a fund-paid expense and every transfer create no debt (D5). Expenses by id; empty for malformed ids. Ruling P339:
   * each with its date, creation instant and id, its place in the space's balance history. Ruling P342 (S4): each with
   * its own currency, which its payments, shares and amount are in.
   */
  async debtMovements(spaceId: string): Promise<SpaceDebtMovements> {
    if (!isUuid(spaceId)) return { expenses: [], settlements: [] };
    const db = this.tm.executor();
    const { memberPaid, settlements } = this.debtFilters(spaceId);
    type Kind = "payment" | "share" | "settlement";
    // Same selection shape in every branch of the UNION ALL; amounts as text, so they never round.
    const text = (column: AnyColumn) => sql<string | null>`${column}::text`;
    const none = sql<string | null>`null::text`;
    const rows = await unionAll(
      db
        .select({
          kind: sql<Kind>`'payment'::text`,
          transactionId: text(transactions.id),
          date: sql<string>`${transactions.date}::text`,
          createdAt: transactions.createdAt,
          currency: sql<string>`${transactions.currency}`,
          position: sql<number>`${payments.position}::integer`,
          memberId: text(payments.memberId),
          receiverId: none,
          onBehalfOfId: none,
          reason: none,
          amount: sql<string>`${payments.amount}::text`,
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(memberPaid),
      db
        .select({
          kind: sql<Kind>`'share'::text`,
          transactionId: text(transactions.id),
          date: sql<string>`${transactions.date}::text`,
          createdAt: transactions.createdAt,
          currency: sql<string>`${transactions.currency}`,
          position: sql<number>`${shares.position}::integer`,
          memberId: text(shares.memberId),
          receiverId: none,
          onBehalfOfId: none,
          reason: none,
          amount: sql<string>`${shares.amount}::text`,
        })
        .from(shares)
        .innerJoin(transactions, eq(transactions.id, shares.transactionId))
        .where(memberPaid),
      db
        .select({
          kind: sql<Kind>`'settlement'::text`,
          transactionId: text(transactions.id),
          date: sql<string>`${transactions.date}::text`,
          createdAt: transactions.createdAt,
          currency: sql<string>`${transactions.currency}`,
          position: sql<number>`0`,
          memberId: text(transactions.payerMemberId),
          receiverId: text(transactions.receivingMemberId),
          onBehalfOfId: text(transactions.onBehalfOfMemberId),
          reason: text(transactions.settlementReason),
          amount: sql<string>`${transactions.amount}::text`,
        })
        .from(transactions)
        .where(settlements),
    );
    rows.sort((a, b) =>
      a.transactionId! < b.transactionId!
        ? -1
        : a.transactionId! > b.transactionId!
          ? 1
          : Number(a.position) - Number(b.position),
    );
    type Parts = { memberId: string; amount: bigint }[];
    const expenses = new Map<
      string,
      SpaceDebtMovements["expenses"][number] & { payments: Parts; shares: Parts }
    >();
    const settled: SpaceDebtMovements["settlements"][number][] = [];
    for (const row of rows) {
      const amount = BigInt(row.amount);
      // Ruling P339: each movement's place in the space's balance history.
      const place = {
        transactionId: row.transactionId!,
        date: row.date as LocalDate,
        createdAt: new Date(row.createdAt),
        currency: row.currency,
      };
      if (row.kind === "settlement") {
        settled.push({
          ...place,
          payerMemberId: row.memberId!,
          receivingMemberId: row.receiverId!,
          amount,
          reason: (row.reason ?? "PAYMENT") as SettlementReason,
          onBehalfOfMemberId: row.onBehalfOfId,
        });
        continue;
      }
      const expense = expenses.get(row.transactionId!) ?? { ...place, payments: [], shares: [] };
      (row.kind === "payment" ? expense.payments : expense.shares).push({ memberId: row.memberId!, amount });
      expenses.set(row.transactionId!, expense);
    }
    return { expenses: [...expenses.values()], settlements: settled };
  }

  /**
   * E5 balance rule, D5: the live member-paid expenses of one space (no payment from the shared fund) and its live
   * settlements; what `memberTotals` sums and `debtMovements` lists.
   */
  private debtFilters(spaceId: string) {
    const fundPayments = alias(payments, "fund_payments");
    const live = and(eq(transactions.spaceId, spaceId), isNull(transactions.deletedAt));
    const memberPaid = and(
      live,
      eq(transactions.type, "EXPENSE"),
      notExists(
        this.tm
          .executor()
          .select({ one: sql`1` })
          .from(fundPayments)
          .where(and(eq(fundPayments.transactionId, transactions.id), isNull(fundPayments.memberId))),
      ),
    );
    return { memberPaid, settlements: and(live, eq(transactions.type, "SETTLEMENT")) };
  }

  /**
   * Spec 5.4, HU-E6-04: Σ live expenses of the space per category within [from, to], for budget lines (D7). Ruling P342
   * (S7): counted in `currency`, the space's own when absent (`countedIn`); a category where nothing counts is absent.
   */
  async expensesByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
    currency?: string,
  ): Promise<{ categoryId: string; amount: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const counted = countedIn(countedCurrency(currency, spaceId));
    const rows = await this.tm
      .executor()
      .select({ categoryId: transactions.categoryId, total: countedSumAsText(counted) })
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
      row.categoryId === null || row.total === null
        ? []
        : [{ categoryId: row.categoryId, amount: BigInt(row.total) }],
    );
  }

  /**
   * Spec 5.4, HU-E6-03: Σ live transfers into each account within [from, to], for SAVINGS lines. Not scoped to a
   * space: a savings account lives in its owner's personal space while the line may belong to a shared space. Ruling
   * P342 (S7): counted in `currency` (the plan's), else in each receiving account's own: what arrived there.
   */
  async transfersIntoAccounts(
    accountIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
    currency?: string,
  ): Promise<{ accountId: string; amount: bigint }[]> {
    const ids = accountIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({
        accountId: transactions.destinationAccountId,
        total: countedSumAsText(countedIn(intoCurrency(currency))),
      })
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
      row.accountId === null || row.total === null
        ? []
        : [{ accountId: row.accountId, amount: BigInt(row.total) }],
    );
  }

  /**
   * `expensesByCategory` for each of `ranges` in one statement, so a view figuring a chain of plans sums every period
   * at once; the answer at index i is the rows `expensesByCategory(spaceId, ranges[i].start, ranges[i].end)` gives.
   */
  async expensesByCategoryIn(
    spaceId: string,
    ranges: readonly DateRange[],
    currency?: string,
  ): Promise<{ categoryId: string; amount: bigint }[][]> {
    const found = ranges.map((): { categoryId: string; amount: bigint }[] => []);
    if (!isUuid(spaceId) || ranges.length === 0) return found;
    const counted = countedIn(countedCurrency(currency, spaceId));
    const { rows } = await this.tm.executor().execute<{ i: number; key: string; total: string | null }>(sql`
      SELECT r.i AS i, ${transactions.categoryId} AS key, sum(${counted})::text AS total
      FROM (VALUES ${rangeRows(ranges)}) AS r(i, start_date, end_date)
      JOIN ${transactions} ON ${transactions.date} BETWEEN r.start_date AND r.end_date
      WHERE ${and(
        eq(transactions.spaceId, spaceId),
        eq(transactions.type, "EXPENSE"),
        isNull(transactions.deletedAt),
        isNotNull(transactions.categoryId),
      )}
      GROUP BY r.i, ${transactions.categoryId}
      ORDER BY r.i, ${transactions.categoryId}`);
    for (const row of rows)
      if (row.total !== null) found[row.i]?.push({ categoryId: row.key, amount: BigInt(row.total) });
    return found;
  }

  /**
   * `transfersIntoAccounts` for each of `ranges` in one statement; the answer at index i is the rows
   * `transfersIntoAccounts(accountIds, ranges[i].start, ranges[i].end)` gives.
   */
  async transfersIntoAccountsIn(
    accountIds: readonly string[],
    ranges: readonly DateRange[],
    currency?: string,
  ): Promise<{ accountId: string; amount: bigint }[][]> {
    const found = ranges.map((): { accountId: string; amount: bigint }[] => []);
    const ids = accountIds.filter(isUuid);
    if (ids.length === 0 || ranges.length === 0) return found;
    const counted = countedIn(intoCurrency(currency));
    const { rows } = await this.tm.executor().execute<{ i: number; key: string; total: string | null }>(sql`
      SELECT r.i AS i, ${transactions.destinationAccountId} AS key, sum(${counted})::text AS total
      FROM (VALUES ${rangeRows(ranges)}) AS r(i, start_date, end_date)
      JOIN ${transactions} ON ${transactions.date} BETWEEN r.start_date AND r.end_date
      WHERE ${and(
        eq(transactions.type, "TRANSFER"),
        isNull(transactions.deletedAt),
        inArray(transactions.destinationAccountId, ids),
      )}
      GROUP BY r.i, ${transactions.destinationAccountId}
      ORDER BY r.i, ${transactions.destinationAccountId}`);
    for (const row of rows)
      if (row.total !== null) found[row.i]?.push({ accountId: row.key, amount: BigInt(row.total) });
    return found;
  }

  /**
   * HU-E5-04 (E5 balance rule, D7): one member's balance-affecting movements in one space with a window function's
   * running balance over every earlier movement: live member-paid expenses they paid for or share (paid − share;
   * fund-paid expenses create no debt, D5) and settlements they paid (+) or received (−), in date, creation and id
   * order, through `to`. The statement itself keeps only the last movement before `from` and flags it `before_range`:
   * its balance is the opening, and the application only splits it from the entries, so the opening and the entries
   * come from one statement and one snapshot. Malformed ids answer an empty history. Ruling P342 (S4): only the movements
   * in `currency` (the space's own when absent) count, so the running balance is in that one currency.
   */
  async memberHistory(
    spaceId: string,
    memberId: string,
    range: HistoryRange,
    currency?: string,
  ): Promise<MemberBalanceHistory> {
    if (!isUuid(spaceId) || !isUuid(memberId)) return { opening: 0n, entries: [] };
    interface HistoryRow {
      readonly id: string;
      readonly date: string;
      readonly type: "EXPENSE" | "SETTLEMENT";
      readonly description: string;
      readonly change: string;
      readonly balance: string;
      readonly reason: "PAYMENT" | "GIFT" | "FORGIVENESS" | null;
      readonly payer: string | null;
      readonly receiver: string | null;
      readonly on_behalf_of: string | null;
      readonly linked: string | null;
      /** The last movement before `from`, whose balance is the opening; false for every entry. */
      readonly before_range: boolean;
    }
    const { rows } = await this.tm.executor().execute(sql`
      -- The spaces table by name: the spaces module's schema is not part of its public API (ADR 0001).
      WITH wanted AS (
        SELECT coalesce(${currency ?? null}::text, (SELECT s.currency FROM spaces s WHERE s.id = ${spaceId})) AS currency
      ), movements AS (
        SELECT t.id, t.date, t.created_at, t.type, t.description,
          NULL::text AS reason, NULL::uuid AS payer, NULL::uuid AS receiver, NULL::uuid AS on_behalf_of, NULL::uuid AS linked,
          coalesce((SELECT sum(p.amount) FROM ${payments} p WHERE p.transaction_id = t.id AND p.member_id = ${memberId}), 0)
            - coalesce((SELECT sum(s.amount) FROM ${shares} s WHERE s.transaction_id = t.id AND s.member_id = ${memberId}), 0)
            AS change
        FROM ${transactions} t
        WHERE t.space_id = ${spaceId} AND t.deleted_at IS NULL AND t.type = 'EXPENSE'
          AND t.currency = (SELECT currency FROM wanted)
          AND NOT EXISTS (SELECT 1 FROM ${payments} f WHERE f.transaction_id = t.id AND f.member_id IS NULL)
        UNION ALL
        SELECT t.id, t.date, t.created_at, t.type, t.description,
          coalesce(t.settlement_reason, 'PAYMENT'), t.payer_member_id, t.receiving_member_id, t.on_behalf_of_member_id,
          t.linked_transaction_id,
          CASE WHEN t.payer_member_id = ${memberId} THEN t.amount
            WHEN t.receiving_member_id = ${memberId} THEN -t.amount ELSE 0 END
        FROM ${transactions} t
        WHERE t.space_id = ${spaceId} AND t.deleted_at IS NULL AND t.type = 'SETTLEMENT'
          AND t.currency = (SELECT currency FROM wanted)
          AND ${memberId} IN (t.payer_member_id, t.receiving_member_id, t.on_behalf_of_member_id)
      ), running AS (
        SELECT id, date, created_at, type, description, change, reason, payer, receiver, on_behalf_of, linked,
          sum(change) OVER (ORDER BY date, created_at, id) AS balance,
          lead(date) OVER (ORDER BY date, created_at, id) AS next_date
        FROM movements
        -- Ruling P322: a payment made for the member moves nothing of theirs, yet is listed with a change of 0.
        WHERE (change <> 0 OR on_behalf_of = ${memberId}::uuid) AND (${range.to}::date IS NULL OR date <= ${range.to}::date)
      )
      SELECT id, date::text AS date, type, description, change::text AS change, balance::text AS balance,
        reason, payer, receiver, on_behalf_of, linked,
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
          // Ruling P322: who paid whom, why and for whom; only a settlement says it.
          ...(row.type === "SETTLEMENT"
            ? {
                settlementReason: row.reason!,
                payerMemberId: row.payer!,
                receivingMemberId: row.receiver!,
                onBehalfOfMemberId: row.on_behalf_of,
                linkedTransactionId: row.linked,
              }
            : {}),
        })),
    };
  }

  /**
   * HU-E7-02, spec 5.4: per category and member, Σ the member's payments and Σ their shares over the live expenses of
   * the space dated within [from, to]. A fund payment has no member, so it counts for nobody (D5). One statement, so
   * both sums come from one snapshot; sorted by category, then member; `[]` for malformed ids. Ruling P342 (S7): counted
   * in `currency`, the space's own when absent: a payment by its leg in it (`paymentCountedIn`), and a share of an
   * expense in another currency by its part of what was counted (`foreignSharesIn`, read in a second statement).
   */
  async memberSumsByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
    currency?: string,
  ): Promise<{ categoryId: string; memberId: string; paid: bigint; consumed: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const db = this.tm.executor();
    const c = countedCurrency(currency, spaceId);
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
          total: countedSumAsText(paymentCountedIn(c)),
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
          total: countedSumAsText(sql`${shares.amount}`),
        })
        .from(shares)
        .innerJoin(transactions, eq(transactions.id, shares.transactionId))
        .where(and(expenses, sql`${transactions.currency} = ${c}`))
        .groupBy(transactions.categoryId, shares.memberId),
    );
    const foreign = (await this.foreignSharesIn(c, expenses)).map((part) => ({
      categoryId: part.categoryId,
      memberId: part.memberId as string | null,
      field: "consumed" as Field,
      total: String(part.amount) as string | null,
    }));
    const sums = new Map<string, { categoryId: string; memberId: string; paid: bigint; consumed: bigint }>();
    for (const row of [...rows, ...foreign]) {
      if (row.categoryId === null || row.memberId === null || row.total === null) continue;
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
   * Ruling P342 (S7): counted in `currency`, the space's own when absent (`countedIn`).
   */
  async fundContributionsByMember(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
    currency?: string,
  ): Promise<{ memberId: string; amount: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const counted = countedIn(countedCurrency(currency, spaceId));
    const rows = await this.tm
      .executor()
      .select({ memberId: transactions.payerMemberId, total: countedSumAsText(counted) })
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
      row.memberId === null || row.total === null
        ? []
        : [{ memberId: row.memberId, amount: BigInt(row.total) }],
    );
  }

  /**
   * D26: per category and contributor, Σ the live contributions to the fund dated within [from, to] whose linked
   * expense (the one they paid for the fund) is live too, by that expense's category; sorted by category, then member.
   * Ruling P342 (S7): each contribution counted in `currency`, the space's own when absent (`countedIn`).
   */
  async paidForFundByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
    currency?: string,
  ): Promise<{ categoryId: string; memberId: string; amount: bigint }[]> {
    if (!isUuid(spaceId)) return [];
    const counted = countedIn(countedCurrency(currency, spaceId));
    const expense = alias(transactions, "paid_expense");
    const rows = await this.tm
      .executor()
      .select({
        categoryId: expense.categoryId,
        memberId: transactions.payerMemberId,
        total: countedSumAsText(counted),
      })
      .from(transactions)
      .innerJoin(
        expense,
        and(
          eq(expense.id, transactions.linkedTransactionId),
          eq(expense.spaceId, transactions.spaceId),
          eq(expense.type, "EXPENSE"),
          isNull(expense.deletedAt),
        ),
      )
      .where(
        and(
          eq(transactions.spaceId, spaceId),
          eq(transactions.type, "TRANSFER"),
          isNotNull(transactions.payerMemberId),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(expense.categoryId, transactions.payerMemberId)
      .orderBy(asc(expense.categoryId), asc(transactions.payerMemberId));
    return rows.flatMap((row) =>
      row.memberId === null || row.categoryId === null || row.total === null
        ? []
        : [{ categoryId: row.categoryId, memberId: row.memberId, amount: BigInt(row.total) }],
    );
  }

  /**
   * HU-E7-04, spec 5.4 (D11): Σ the shares of `memberIds`, one user's member rows, over live expenses dated within
   * [from, to], per space and category, whatever space recorded them; sorted by space, then category; `[]` without
   * well-formed ids. Ruling P342 (S7): counted in `currency`, else in each space's own: a share of an expense in it as
   * is, a share of one in another currency by its part of what accounts in it moved (`foreignSharesIn`).
   */
  async consumptionByCategory(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
    currency?: string,
  ): Promise<{ spaceId: string; categoryId: string; amount: bigint }[]> {
    const ids = memberIds.filter(isUuid);
    if (ids.length === 0) return [];
    const db = this.tm.executor();
    const c = countedCurrency(currency, transactions.spaceId);
    const expenses = and(
      // Defensive: only expenses carry shares today, so this never drops a row.
      eq(transactions.type, "EXPENSE"),
      isNull(transactions.deletedAt),
      between(transactions.date, from, to),
    );
    const rows = await db
      .select({
        spaceId: transactions.spaceId,
        categoryId: transactions.categoryId,
        total: sumAsText(shares.amount),
      })
      .from(shares)
      .innerJoin(transactions, eq(transactions.id, shares.transactionId))
      .where(and(inArray(shares.memberId, ids), expenses, sql`${transactions.currency} = ${c}`))
      .groupBy(transactions.spaceId, transactions.categoryId);
    const theirs = db
      .select({ one: sql`1` })
      .from(shares)
      .where(and(eq(shares.transactionId, transactions.id), inArray(shares.memberId, ids)));
    const foreign = (await this.foreignSharesIn(c, and(expenses, exists(theirs)))).filter((part) =>
      ids.includes(part.memberId),
    );
    const sums = new Map<string, { spaceId: string; categoryId: string; amount: bigint }>();
    const add = (spaceId: string, categoryId: string | null, amount: bigint) => {
      if (categoryId === null) return;
      const key = `${spaceId}/${categoryId}`;
      const entry = sums.get(key) ?? { spaceId, categoryId, amount: 0n };
      entry.amount += amount;
      sums.set(key, entry);
    };
    for (const row of rows) add(row.spaceId, row.categoryId, BigInt(row.total));
    for (const part of foreign) add(part.spaceId, part.categoryId, part.amount);
    return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, entry]) => entry);
  }

  /**
   * Ruling P342: `consumptionByCategory` for the unified view, which converts: Σ the shares of `memberIds` per space,
   * category and the movement's own currency, never counted in another; sorted by space, category, then currency.
   */
  async consumptionByCurrency(
    memberIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ spaceId: string; categoryId: string; currency: string; amount: bigint }[]> {
    const ids = memberIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({
        spaceId: transactions.spaceId,
        categoryId: transactions.categoryId,
        currency: transactions.currency,
        total: sumAsText(shares.amount),
      })
      .from(shares)
      .innerJoin(transactions, eq(transactions.id, shares.transactionId))
      .where(
        and(
          inArray(shares.memberId, ids),
          eq(transactions.type, "EXPENSE"),
          isNull(transactions.deletedAt),
          between(transactions.date, from, to),
        ),
      )
      .groupBy(transactions.spaceId, transactions.categoryId, transactions.currency)
      .orderBy(asc(transactions.spaceId), asc(transactions.categoryId), asc(transactions.currency));
    return rows.flatMap((row) =>
      row.categoryId === null
        ? []
        : [
            {
              spaceId: row.spaceId,
              categoryId: row.categoryId,
              currency: row.currency,
              amount: BigInt(row.total),
            },
          ],
    );
  }

  /**
   * HU-E7-04, spec 5.4: what `memberIds` paid out within [from, to]: their payments of live expenses and their live
   * fund contributions, each with the part without an account ("outside the app": a guest's history before a claim).
   * Ruling P342: one entry per movement currency with anything paid, sorted by currency, never converted (the unified
   * view converts each from its own currency).
   */
  async cashOut(memberIds: readonly string[], from: LocalDate, to: LocalDate): Promise<CashOutByCurrency[]> {
    const ids = memberIds.filter(isUuid);
    if (ids.length === 0) return [];
    const db = this.tm.executor();
    const live = and(isNull(transactions.deletedAt), between(transactions.date, from, to));
    type Kind = "payment" | "contribution";
    // One statement, so both sums come from one snapshot; same selection shape in both branches of the UNION ALL.
    const rows = await unionAll(
      db
        .select({
          kind: sql<Kind>`'payment'::text`,
          currency: transactions.currency,
          total: sumAsText(payments.amount),
          outside: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.accountId} is null), 0)::text`,
        })
        .from(payments)
        .innerJoin(transactions, eq(transactions.id, payments.transactionId))
        .where(and(live, eq(transactions.type, "EXPENSE"), inArray(payments.memberId, ids)))
        .groupBy(transactions.currency),
      db
        .select({
          kind: sql<Kind>`'contribution'::text`,
          currency: transactions.currency,
          total: sumAsText(transactions.amount),
          outside: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.sourceAccountId} is null), 0)::text`,
        })
        .from(transactions)
        .where(and(live, eq(transactions.type, "TRANSFER"), inArray(transactions.payerMemberId, ids)))
        .groupBy(transactions.currency),
    );
    const byCurrency = new Map<string, CashOutByCurrency>();
    for (const row of rows) {
      const entry = byCurrency.get(row.currency) ?? {
        currency: row.currency,
        payments: 0n,
        paymentsOutsideTheApp: 0n,
        fundContributions: 0n,
        contributionsOutsideTheApp: 0n,
      };
      byCurrency.set(
        row.currency,
        row.kind === "payment"
          ? {
              ...entry,
              payments: entry.payments + BigInt(row.total),
              paymentsOutsideTheApp: entry.paymentsOutsideTheApp + BigInt(row.outside),
            }
          : {
              ...entry,
              fundContributions: entry.fundContributions + BigInt(row.total),
              contributionsOutsideTheApp: entry.contributionsOutsideTheApp + BigInt(row.outside),
            },
      );
    }
    return [...byCurrency.values()].sort((a, b) =>
      a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
    );
  }

  /**
   * Ruling P329: the movements that involve one of the member rows, by the row's payer, receiver or the one a settlement
   * was made for, or an expense's payments and shares; and every movement of the `alwaysIn` spaces. No condition when
   * `f` is absent, and none matches without a valid member or space.
   */
  private involving(f: Involving | undefined) {
    if (f === undefined) return undefined;
    const db = this.tm.executor();
    const members = f.memberIds.filter(isUuid);
    const always = f.alwaysIn.filter(isUuid);
    const theirs =
      members.length === 0
        ? []
        : [
            inArray(transactions.payerMemberId, members),
            inArray(transactions.receivingMemberId, members),
            inArray(transactions.onBehalfOfMemberId, members),
            exists(
              db
                .select({ one: sql`1` })
                .from(payments)
                .where(and(eq(payments.transactionId, transactions.id), inArray(payments.memberId, members))),
            ),
            exists(
              db
                .select({ one: sql`1` })
                .from(shares)
                .where(and(eq(shares.transactionId, transactions.id), inArray(shares.memberId, members))),
            ),
          ];
    return (
      or(always.length === 0 ? undefined : inArray(transactions.spaceId, always), ...theirs) ?? sql`false`
    );
  }

  private matching(f: TransactionFilter) {
    return this.matchingIn(eq(transactions.spaceId, f.spaceId), f);
  }

  /** The list's conditions (HU-E4-05, P277) within `spaces`: one space's, or several (ruling P319). */
  private matchingIn(spaces: SQL, f: Omit<TransactionFilter, "spaceId">) {
    const db = this.tm.executor();
    return and(
      spaces,
      isNull(transactions.deletedAt),
      between(transactions.date, f.from, f.to),
      f.type === undefined ? undefined : eq(transactions.type, f.type),
      f.categoryIds === undefined || f.categoryIds.length === 0
        ? undefined
        : inArray(transactions.categoryId, [...f.categoryIds]),
      // Issue #246: an expense's payers are on its payments; a settlement's payer and a fund contributor are on the row.
      f.payerMemberId === undefined
        ? undefined
        : or(
            eq(transactions.payerMemberId, f.payerMemberId),
            exists(
              db
                .select({ one: sql`1` })
                .from(payments)
                .where(
                  and(eq(payments.transactionId, transactions.id), eq(payments.memberId, f.payerMemberId)),
                ),
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
      // Ruling P277: an income's or a transfer's accounts are on the row, an expense's on its payments.
      f.accountId === undefined
        ? undefined
        : or(
            eq(transactions.sourceAccountId, f.accountId),
            eq(transactions.destinationAccountId, f.accountId),
            exists(
              db
                .select({ one: sql`1` })
                .from(payments)
                .where(and(eq(payments.transactionId, transactions.id), eq(payments.accountId, f.accountId))),
            ),
          ),
      f.search === undefined ? undefined : ilike(transactions.description, `%${literalLike(f.search)}%`),
    );
  }
}
