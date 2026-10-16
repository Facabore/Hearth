import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import {
  accountFixture,
  guestMemberFixture,
  sharedLedgerFixture,
  type SharedLedgerFixture,
} from "../../../../tests/support/fixtures";
import { InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import type { HistoryRange, MemberBalanceHistory, MemberMoneyTotals } from "../application/ports";
import {
  recordExpense,
  recordFundContribution,
  recordIncome,
  recordSettlement,
  recordTransfer,
  softDelete,
  type Payment,
  type Share,
  type Transaction,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const queries = new DrizzleLedgerQueries(tm);

afterAll(() => pool.end());

const pesos = (n: bigint) => n * 100n;
const day = (iso: string) => iso as LocalDate;
const open: HistoryRange = { from: null, to: null };
const nothing: MemberBalanceHistory = { opening: 0n, entries: [] };
/**
 * A transaction of Household on `date`, created `minute` minutes after 2026-10-01 12:00Z; `idPrefix` (8 hex digits)
 * fixes where its id sorts. Its description names the day and minute, so every movement is told apart.
 */
const base = (w: SharedLedgerFixture, date: string, minute: number, amount: bigint, idPrefix?: string) => ({
  id: (idPrefix === undefined ? randomUUID() : `${idPrefix}-${randomUUID().slice(9)}`) as TransactionId,
  spaceId: w.household.spaceId,
  description: `${date} #${minute}`,
  date: day(date),
  amount,
  currency: "COP",
  createdBy: w.household.userId,
  now: new Date(Date.UTC(2026, 9, 1, 12, minute)),
});
/** An expense of `amount` paid in full by `payer`, split equally among `participants`. */
const expense = (
  w: SharedLedgerFixture,
  date: string,
  minute: number,
  amount: bigint,
  payer: { memberId: string | null; accountId: string | null },
  participants: readonly string[],
  idPrefix?: string,
) => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(w, date, minute, amount, idPrefix),
      categoryId: w.groceries,
      payments: [{ ...payer, amount }],
      shares: participants.map((memberId, index) => ({
        memberId,
        amount: parts[index]!.minor,
        splitMethod: "EQUAL" as const,
      })),
    }),
  );
};
/** An expense whose payments and shares are given part by part: several payers, BY_ALLOCATION or EXACT shares. */
const splitExpense = (
  w: SharedLedgerFixture,
  date: string,
  minute: number,
  amount: bigint,
  payments: readonly Payment[],
  shares: readonly Share[],
) => unwrap(recordExpense({ ...base(w, date, minute, amount), categoryId: w.groceries, payments, shares }));
const settlement = (
  w: SharedLedgerFixture,
  date: string,
  minute: number,
  amount: bigint,
  payerMemberId: string,
  receivingMemberId: string,
  idPrefix?: string,
) =>
  unwrap(
    recordSettlement({
      ...base(w, date, minute, amount, idPrefix),
      payerMemberId,
      receivingMemberId,
      sourceAccountId: null,
      destinationAccountId: null,
    }),
  );
/** Stores the same transactions in PostgreSQL and in the in-memory twin. */
const storeInBoth = async (memory: InMemoryTransactions, ...txs: Transaction[]) => {
  for (const tx of txs) {
    await repo.add(tx);
    await memory.add(tx);
  }
};
/** A member's net as balances reads it from the totals (E5 balance rule); the ledger cannot import balances. */
const netOfTotals = (totals: MemberMoneyTotals | undefined) =>
  totals === undefined ? 0n : totals.paid - totals.consumed + totals.settledOut - totals.settledIn;
/** Where the member's net ends: after their last movement, or where the range opened when there is none. */
const closingOf = (history: MemberBalanceHistory) => history.entries.at(-1)?.balance ?? history.opening;
const RANGES: readonly HistoryRange[] = [
  open,
  { from: day("2026-10-01"), to: day("2026-10-15") },
  { from: day("2026-10-06"), to: null },
  { from: null, to: day("2026-10-05") },
  { from: day("2026-10-13"), to: day("2026-10-25") },
  // A single day with two movements, a range after every movement and one before them all.
  { from: day("2026-10-05"), to: day("2026-10-05") },
  { from: day("2026-12-31"), to: null },
  { from: null, to: day("2026-09-30") },
];

describe("a member's balance history in SQL (HU-E5-04)", () => {
  /**
   * Household with Ana and the guest Pedro: Ana pays 300,000 EQUAL (10-03); on 10-05 Ana settles 10,000 to Pedro
   * (created first) and Pedro pays Ana's 40,000 lunch; Pedro pays 100,000 EQUAL (10-10); the fund pays 80,000 of
   * Pedro's (10-12, no debt); Ana's 60,000 of 10-20 is soft-deleted; Pedro settles 100,000 to Ana (10-30). Among
   * them, in the same space and so only kept out by the balance rule: Pedro's 200,000 contribution to the fund
   * (10-04), Ana's 900,000 income (10-08) and her 50,000 transfer between her own accounts (10-15).
   */
  const fixture = async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const memory = new InMemoryTransactions();
    const dinner = expense(w, "2026-10-03", 0, pesos(300_000n), { memberId: ana, accountId: w.bank }, [
      ana,
      w.pedro,
    ]);
    // Ids that sort against creation order: a window ordered by date and id alone would swap these two.
    const lunch = expense(
      w,
      "2026-10-05",
      2,
      pesos(40_000n),
      { memberId: w.pedro, accountId: null },
      [ana],
      "00000000",
    );
    const payback = settlement(w, "2026-10-05", 1, pesos(10_000n), ana, w.pedro, "ffffffff");
    const pedroPays = expense(w, "2026-10-10", 3, pesos(100_000n), { memberId: w.pedro, accountId: null }, [
      ana,
      w.pedro,
    ]);
    const fundPays = expense(w, "2026-10-12", 4, pesos(80_000n), { memberId: null, accountId: w.fund }, [
      w.pedro,
    ]);
    const deleted = softDelete(
      expense(w, "2026-10-20", 5, pesos(60_000n), { memberId: ana, accountId: w.bank }, [ana, w.pedro]),
      new Date(),
    );
    const settleUp = settlement(w, "2026-10-30", 6, pesos(100_000n), w.pedro, ana);
    // Not debts between members (D5): a fund contribution, an income and a transfer never count.
    const contribution = unwrap(
      recordFundContribution({
        ...base(w, "2026-10-04", 7, pesos(200_000n)),
        payerMemberId: w.pedro,
        sourceAccountId: null,
        destinationAccountId: w.fund,
      }),
    );
    const salary = unwrap(
      recordIncome({
        ...base(w, "2026-10-08", 8, pesos(900_000n)),
        categoryId: w.groceries,
        destinationAccountId: w.bank,
        receivingMemberId: ana,
      }),
    );
    const move = unwrap(
      recordTransfer({
        ...base(w, "2026-10-15", 9, pesos(50_000n)),
        sourceAccountId: w.bank,
        destinationAccountId: await accountFixture(db, w.personal, "Nequi"),
      }),
    );
    await storeInBoth(
      memory,
      dinner,
      contribution,
      lunch,
      payback,
      salary,
      pedroPays,
      fundPays,
      move,
      deleted,
      settleUp,
    );
    return { w, ana, memory, dinner, lunch, payback, pedroPays, settleUp, contribution, salary, move };
  };

  /**
   * Household with Ana, the guests Pedro and Sofi: Ana pays 120,000 BY_ALLOCATION 40/60 with Pedro (10-02); Ana pays
   * 30,000 for herself alone (10-03, no change for anyone); Ana and Pedro pay 100,000 together, 60,000 and 40,000,
   * which Ana, Pedro and Sofi owe EXACT 30,000, 30,000 and 40,000 (10-04); the next period's 120,000 goes 50/50
   * (11-02); Ana's 5,000 settlement to Pedro is soft-deleted (11-03); Pedro settles 20,000 to Ana (11-04), which
   * Sofi has no part in.
   */
  const allocationFixture = async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const sofi = await guestMemberFixture(pool, w.household, "Sofi");
    const memory = new InMemoryTransactions();
    const allocated = (date: string, minute: number, anaShare: bigint, pedroShare: bigint) =>
      splitExpense(
        w,
        date,
        minute,
        pesos(120_000n),
        [{ memberId: ana, accountId: w.bank, amount: pesos(120_000n) }],
        [
          { memberId: ana, amount: pesos(anaShare), splitMethod: "BY_ALLOCATION" },
          { memberId: w.pedro, amount: pesos(pedroShare), splitMethod: "BY_ALLOCATION" },
        ],
      );
    await storeInBoth(
      memory,
      allocated("2026-10-02", 0, 48_000n, 72_000n),
      expense(w, "2026-10-03", 1, pesos(30_000n), { memberId: ana, accountId: w.bank }, [ana]),
      splitExpense(
        w,
        "2026-10-04",
        2,
        pesos(100_000n),
        [
          { memberId: ana, accountId: w.bank, amount: pesos(60_000n) },
          { memberId: w.pedro, accountId: null, amount: pesos(40_000n) },
        ],
        [
          { memberId: ana, amount: pesos(30_000n), splitMethod: "EXACT" },
          { memberId: w.pedro, amount: pesos(30_000n), splitMethod: "EXACT" },
          { memberId: sofi, amount: pesos(40_000n), splitMethod: "EXACT" },
        ],
      ),
      allocated("2026-11-02", 3, 60_000n, 60_000n),
      softDelete(settlement(w, "2026-11-03", 4, pesos(5_000n), ana, w.pedro), new Date()),
      settlement(w, "2026-11-04", 5, pesos(20_000n), w.pedro, ana),
    );
    return { w, ana, sofi, memory };
  };

  it("matches the in-memory twin for every member and range (Review Focus 4)", async () => {
    const { w, ana, memory } = await fixture();
    for (const memberId of [ana, w.pedro]) {
      for (const range of RANGES) {
        expect(await queries.memberHistory(w.household.spaceId, memberId, range)).toEqual(
          await memory.memberHistory(w.household.spaceId, memberId, range),
        );
      }
    }
    const split = await allocationFixture();
    for (const memberId of [split.ana, split.w.pedro, split.sofi]) {
      for (const range of RANGES) {
        expect(await queries.memberHistory(split.w.household.spaceId, memberId, range)).toEqual(
          await split.memory.memberHistory(split.w.household.spaceId, memberId, range),
        );
      }
    }
  });

  it("runs Pedro's net through every movement by date, then creation time, without the fund's or the deleted expense", async () => {
    const { w, dinner, payback, lunch, pedroPays, settleUp } = await fixture();
    const history = await queries.memberHistory(w.household.spaceId, w.pedro, open);
    expect(history.entries.map((e) => [e.date, e.type, e.change, e.balance])).toEqual([
      ["2026-10-03", "EXPENSE", pesos(-150_000n), pesos(-150_000n)],
      ["2026-10-05", "SETTLEMENT", pesos(-10_000n), pesos(-160_000n)],
      ["2026-10-05", "EXPENSE", pesos(40_000n), pesos(-120_000n)],
      ["2026-10-10", "EXPENSE", pesos(50_000n), pesos(-70_000n)],
      ["2026-10-30", "SETTLEMENT", pesos(100_000n), pesos(30_000n)],
    ]);
    expect(history.entries.map((e) => [e.transactionId, e.description])).toEqual(
      [dinner, payback, lunch, pedroPays, settleUp].map((tx) => [tx.id, tx.description]),
    );
    const later = await queries.memberHistory(w.household.spaceId, w.pedro, {
      from: day("2026-10-13"),
      to: day("2026-10-25"),
    });
    expect(later).toEqual({ opening: pesos(-70_000n), entries: [] });
  });

  it("leaves fund contributions, incomes and transfers out of every member's history and net (D5)", async () => {
    const { w, ana, memory, contribution, salary, move } = await fixture();
    const left: string[] = [contribution, salary, move].map((tx) => tx.id);
    for (const [memberId, net] of [
      [ana, pesos(-30_000n)],
      [w.pedro, pesos(30_000n)],
    ] as const) {
      for (const history of [
        await queries.memberHistory(w.household.spaceId, memberId, open),
        await memory.memberHistory(w.household.spaceId, memberId, open),
      ]) {
        expect(history.entries.filter((e) => left.includes(e.transactionId))).toEqual([]);
        expect(history.entries.at(-1)?.balance).toBe(net);
      }
    }
  });

  it("orders movements of one day and one instant by id, in SQL and in the twin", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const memory = new InMemoryTransactions();
    // Same date, same creation time. The id that sorts last is stored first, so neither insertion order nor an
    // unordered tie can give the expected order, and a window without the id would show both at the combined balance.
    const lunch = expense(
      w,
      "2026-10-05",
      0,
      pesos(20_000n),
      { memberId: ana, accountId: w.bank },
      [ana, w.pedro],
      "ffffffff",
    );
    const payback = settlement(w, "2026-10-05", 0, pesos(5_000n), w.pedro, ana, "00000000");
    await storeInBoth(memory, lunch, payback);
    const history = await queries.memberHistory(w.household.spaceId, w.pedro, open);
    expect(history.entries.map((e) => [e.transactionId, e.change, e.balance])).toEqual([
      [payback.id, pesos(5_000n), pesos(5_000n)],
      [lunch.id, pesos(-10_000n), pesos(-5_000n)],
    ]);
    expect(await memory.memberHistory(w.household.spaceId, w.pedro, open)).toEqual(history);
  });

  it("opens each range at the net after the last movement before it, however many fall on that day", async () => {
    const { w } = await fixture();
    const range = async (from: string | null, to: string | null) => {
      const history = await queries.memberHistory(w.household.spaceId, w.pedro, {
        from: from === null ? null : day(from),
        to: to === null ? null : day(to),
      });
      return [history.opening, history.entries.map((e) => [e.date, e.change, e.balance])];
    };
    // From the day of two movements: the opening is the net after 10-03 alone.
    expect(await range("2026-10-05", null)).toEqual([
      pesos(-150_000n),
      [
        ["2026-10-05", pesos(-10_000n), pesos(-160_000n)],
        ["2026-10-05", pesos(40_000n), pesos(-120_000n)],
        ["2026-10-10", pesos(50_000n), pesos(-70_000n)],
        ["2026-10-30", pesos(100_000n), pesos(30_000n)],
      ],
    ]);
    // From the day after both: the opening is the net after the later-created of the two.
    expect(await range("2026-10-06", "2026-10-10")).toEqual([
      pesos(-120_000n),
      [["2026-10-10", pesos(50_000n), pesos(-70_000n)]],
    ]);
    // After every movement the net stays where it ended; before them all it has not started.
    expect(await range("2026-12-31", null)).toEqual([pesos(30_000n), []]);
    expect(await range(null, "2026-09-30")).toEqual([0n, []]);
  });

  it("closes every member's open-ended history at the net the balances aggregate reports today", async () => {
    const { w, ana, memory } = await fixture();
    const split = await allocationFixture();
    const cases = [
      {
        space: w.household.spaceId,
        memory,
        nets: [
          [ana, pesos(-30_000n)],
          [w.pedro, pesos(30_000n)],
        ],
      },
      {
        space: split.w.household.spaceId,
        memory: split.memory,
        // Ana: 72,000 + 30,000 + 60,000 − 20,000; Pedro: −72,000 + 10,000 − 60,000 + 20,000; Sofi: −40,000.
        nets: [
          [split.ana, pesos(142_000n)],
          [split.w.pedro, pesos(-102_000n)],
          [split.sofi, pesos(-40_000n)],
        ],
      },
    ] as const;
    for (const { space, memory: twin, nets } of cases) {
      const totals = await queries.memberTotals(space);
      for (const [memberId, net] of nets) {
        const current = netOfTotals(totals.find((t) => t.memberId === memberId));
        expect(current).toBe(net);
        expect(closingOf(await queries.memberHistory(space, memberId, open))).toBe(current);
        expect(netOfTotals((await twin.memberTotals(space)).find((t) => t.memberId === memberId))).toBe(
          current,
        );
        expect(closingOf(await twin.memberHistory(space, memberId, open))).toBe(current);
      }
    }
  });

  it("counts BY_ALLOCATION and EXACT shares and several payers, and leaves out movements that change nothing", async () => {
    const { w, ana, sofi, memory } = await allocationFixture();
    const entries = async (memberId: string) =>
      (await queries.memberHistory(w.household.spaceId, memberId, open)).entries.map((e) => [
        e.date,
        e.type,
        e.change,
        e.balance,
      ]);
    // 10-03 (Ana pays what she alone consumes) and the deleted settlement of 11-03 are nowhere.
    expect(await entries(ana)).toEqual([
      ["2026-10-02", "EXPENSE", pesos(72_000n), pesos(72_000n)],
      ["2026-10-04", "EXPENSE", pesos(30_000n), pesos(102_000n)],
      ["2026-11-02", "EXPENSE", pesos(60_000n), pesos(162_000n)],
      ["2026-11-04", "SETTLEMENT", pesos(-20_000n), pesos(142_000n)],
    ]);
    expect(await entries(w.pedro)).toEqual([
      ["2026-10-02", "EXPENSE", pesos(-72_000n), pesos(-72_000n)],
      ["2026-10-04", "EXPENSE", pesos(10_000n), pesos(-62_000n)],
      ["2026-11-02", "EXPENSE", pesos(-60_000n), pesos(-122_000n)],
      ["2026-11-04", "SETTLEMENT", pesos(20_000n), pesos(-102_000n)],
    ]);
    // Sofi is not a party of the 11-04 settlement, so it never reaches her history.
    expect(await entries(sofi)).toEqual([["2026-10-04", "EXPENSE", pesos(-40_000n), pesos(-40_000n)]]);
    expect(await memory.memberHistory(w.household.spaceId, ana, open)).toEqual(
      await queries.memberHistory(w.household.spaceId, ana, open),
    );
  });

  it("reads one space and one member: another space's rows and members never leak in (Review Focus 5)", async () => {
    const { w, ana } = await fixture();
    const other = await sharedLedgerFixture(db, pool);
    const own = await queries.memberHistory(w.household.spaceId, ana, open);
    // The database does not tie a payment's member to the transaction's space, so only the query's own space
    // filter keeps rows of another space that name Ana out of her history here.
    await repo.add(
      expense(other, "2026-10-04", 7, pesos(90_000n), { memberId: ana, accountId: null }, [ana, w.pedro]),
    );
    await repo.add(settlement(other, "2026-10-06", 8, pesos(20_000n), ana, w.pedro));
    await repo.add(
      expense(
        other,
        "2026-10-07",
        9,
        pesos(50_000n),
        { memberId: other.household.memberId, accountId: null },
        [other.household.memberId, other.pedro],
      ),
    );
    expect(await queries.memberHistory(w.household.spaceId, ana, open)).toEqual(own);
    // Those rows are there: they show in the space they belong to, and only for the members they name.
    const there = await queries.memberHistory(other.household.spaceId, ana, open);
    expect(there.entries.map((e) => [e.type, e.change, e.balance])).toEqual([
      ["EXPENSE", pesos(45_000n), pesos(45_000n)],
      ["SETTLEMENT", pesos(20_000n), pesos(65_000n)],
    ]);
    // Another space's member has no history here, though they have one in their own space.
    expect(
      (await queries.memberHistory(other.household.spaceId, other.household.memberId, open)).entries,
    ).toHaveLength(1);
    expect(await queries.memberHistory(w.household.spaceId, other.household.memberId, open)).toEqual(nothing);
    expect(await queries.memberHistory(w.household.spaceId, other.pedro, open)).toEqual(nothing);
  });

  it("answers an empty history for malformed ids (Review Focus 5)", async () => {
    const { w } = await fixture();
    expect([
      await queries.memberHistory("not-a-uuid", w.pedro, open),
      await queries.memberHistory(w.household.spaceId, "not-a-uuid", open),
    ]).toEqual([nothing, nothing]);
  });
});
