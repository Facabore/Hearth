import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import {
  accountFixture,
  categoryFixture,
  guestMemberFixture,
  personalSpaceFixture,
  sharedLedgerFixture,
} from "../../../../tests/support/fixtures";
import type { TransactionFilter, TransactionPosition } from "../application/ports";
import {
  recordExpense,
  recordFundContribution,
  recordIncome,
  recordSettlement,
  recordTransfer,
  softDelete,
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

const world = async () => {
  const space = await personalSpaceFixture(db, pool);
  return {
    space,
    bank: await accountFixture(db, space, "Bancolombia"),
    wallet: await accountFixture(db, space, "Nequi"),
    groceries: await categoryFixture(db, space, "Groceries"),
    restaurants: await categoryFixture(db, space, "Restaurants"),
    salary: await categoryFixture(db, space, "Salary"),
  };
};
type World = Awaited<ReturnType<typeof world>>;

const common = (w: World, date: string, amount: bigint) => ({
  id: randomUUID() as TransactionId,
  spaceId: w.space.spaceId,
  date: date as LocalDate,
  amount,
  currency: "COP",
  createdBy: w.space.userId,
  now: new Date(),
});
const expense = (
  w: World,
  date: string,
  amount: bigint,
  options: { categoryId?: string; payerMemberId?: string; shares?: Share[] } = {},
) =>
  unwrap(
    recordExpense({
      ...common(w, date, amount),
      categoryId: options.categoryId ?? w.groceries,
      // A guest payer pays outside the app (no account), like HU-E4-07's guest scenario.
      payments: [
        options.payerMemberId
          ? { memberId: options.payerMemberId, accountId: null, amount }
          : { memberId: w.space.memberId, accountId: w.bank, amount },
      ],
      shares: options.shares ?? [{ memberId: w.space.memberId, amount, splitMethod: "EQUAL" }],
    }),
  );
const income = (w: World, date: string, amount: bigint) =>
  unwrap(
    recordIncome({
      ...common(w, date, amount),
      categoryId: w.salary,
      destinationAccountId: w.bank,
      receivingMemberId: w.space.memberId,
    }),
  );
const transfer = (w: World, date: string, amount: bigint) =>
  unwrap(
    recordTransfer({ ...common(w, date, amount), sourceAccountId: w.bank, destinationAccountId: w.wallet }),
  );
const store = async (...txs: Transaction[]) => {
  for (const tx of txs) await repo.add(tx);
};
const october = (w: World, extra: Partial<TransactionFilter> = {}): TransactionFilter => ({
  spaceId: w.space.spaceId,
  from: "2026-10-01" as LocalDate,
  to: "2026-10-31" as LocalDate,
  ...extra,
});

afterAll(() => pool.end());

describe("list and totals (HU-E4-05)", () => {
  it("lists live transactions of the period newest first, with totals", async () => {
    const w = await world();
    const first = expense(w, "2026-10-05", 8_500_000n);
    const second = expense(w, "2026-10-12", 10_000_000n);
    const dinner = expense(w, "2026-10-15", 6_000_000n, { categoryId: w.restaurants });
    const salary = income(w, "2026-10-25", 320_000_000n);
    await store(first, second, dinner, salary, expense(w, "2026-11-01", 4_000_000n));
    await store(softDelete(expense(w, "2026-10-20", 1_000_000n), new Date()));
    const rows = await queries.list(october(w), null, 50);
    expect(rows.map((t) => t.id)).toEqual([salary.id, dinner.id, second.id, first.id]);
    expect(rows[2]).toEqual(second);
    expect(await queries.totals(october(w))).toEqual({ expenses: 24_500_000n, income: 320_000_000n });
  });

  it("filters by category, type, payer and participant", async () => {
    const w = await world();
    const juan = await guestMemberFixture(pool, w.space);
    const market = expense(w, "2026-10-05", 8_500_000n);
    const dinner = expense(w, "2026-10-15", 6_000_000n, { categoryId: w.restaurants });
    const juanPays = expense(w, "2026-10-16", 10_000_000n, {
      payerMemberId: juan,
      shares: [
        { memberId: w.space.memberId, amount: 5_000_000n, splitMethod: "EQUAL" },
        { memberId: juan, amount: 5_000_000n, splitMethod: "EQUAL" },
      ],
    });
    const salary = income(w, "2026-10-25", 320_000_000n);
    await store(market, dinner, juanPays, salary);
    const ids = async (extra: Partial<TransactionFilter>) =>
      (await queries.list(october(w, extra), null, 50)).map((t) => t.id);
    expect(await ids({ categoryIds: [w.groceries] })).toEqual([juanPays.id, market.id]);
    expect(await queries.totals(october(w, { categoryIds: [w.groceries] }))).toEqual({
      expenses: 18_500_000n,
      income: 0n,
    });
    expect(await ids({ type: "INCOME" })).toEqual([salary.id]);
    expect(await ids({ payerMemberId: juan })).toEqual([juanPays.id]);
    expect(await ids({ participantMemberId: juan })).toEqual([juanPays.id]);
  });

  it("visits 120 transactions on the same date exactly once, newest first (Review Focus 2)", async () => {
    const w = await world();
    await store(...Array.from({ length: 120 }, () => expense(w, "2026-10-15", 100n)));
    const seen: string[] = [];
    const sizes: number[] = [];
    let after: TransactionPosition | null = null;
    do {
      const rows = await queries.list(october(w), after, 51);
      const items = rows.slice(0, 50);
      sizes.push(items.length);
      seen.push(...items.map((t) => t.id));
      const last = items.at(-1);
      after = rows.length > 50 && last ? { date: last.date, id: last.id } : null;
    } while (after);
    expect(sizes).toEqual([50, 50, 20]);
    expect(new Set(seen).size).toBe(120);
    expect(seen).toEqual([...seen].sort().reverse());
  });
});

describe("net account movements (HU-E2-04)", () => {
  it("adds incomes and transfers in, subtracts transfers out and payments", async () => {
    const w = await world();
    await store(
      income(w, "2026-10-01", 300_000_000n),
      expense(w, "2026-10-05", 8_500_000n),
      transfer(w, "2026-10-06", 50_000_000n),
    );
    const net = await queries.netMovements([w.bank, w.wallet], null);
    expect(net.get(w.bank)).toBe(241_500_000n);
    expect(net.get(w.wallet)).toBe(50_000_000n);
  });

  it("reduces the payer account by the full payment of a shared expense", async () => {
    const w = await world();
    const juan = await guestMemberFixture(pool, w.space);
    await store(
      expense(w, "2026-10-05", 30_000_000n, {
        shares: [
          { memberId: w.space.memberId, amount: 15_000_000n, splitMethod: "EQUAL" },
          { memberId: juan, amount: 15_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    expect((await queries.netMovements([w.bank], null)).get(w.bank)).toBe(-30_000_000n);
  });

  it("ignores soft-deleted transactions", async () => {
    const w = await world();
    await store(softDelete(expense(w, "2026-10-05", 8_500_000n), new Date()));
    expect((await queries.netMovements([w.bank], null)).get(w.bank) ?? 0n).toBe(0n);
  });

  it("counts only transactions dated on or before asOf", async () => {
    const w = await world();
    await store(expense(w, "2026-10-05", 1_000n), expense(w, "2026-11-03", 2_000n));
    expect((await queries.netMovements([w.bank], "2026-10-31" as LocalDate)).get(w.bank)).toBe(-1_000n);
    expect((await queries.netMovements([w.bank], null)).get(w.bank)).toBe(-3_000n);
  });

  it("stays exact beyond the bigint range (Review Focus 5)", async () => {
    const w = await world();
    await store(
      income(w, "2026-10-01", 6_000_000_000_000_000_000n),
      income(w, "2026-10-02", 6_000_000_000_000_000_000n),
    );
    expect((await queries.netMovements([w.bank], null)).get(w.bank)).toBe(12_000_000_000_000_000_000n);
    expect(await queries.totals(october(w))).toEqual({ expenses: 0n, income: 12_000_000_000_000_000_000n });
  });

  it("returns nothing for no ids or malformed ids", async () => {
    expect((await queries.netMovements([], null)).size).toBe(0);
    expect((await queries.netMovements(["not-a-uuid"], null)).size).toBe(0);
  });
});

describe("references", () => {
  it("reports categories referenced by live or deleted transactions, and spaces with transactions", async () => {
    const w = await world();
    expect(await queries.hasTransactions(w.space.spaceId)).toBe(false);
    expect(await queries.isCategoryReferenced(w.groceries)).toBe(false);
    await store(softDelete(expense(w, "2026-10-05", 100n), new Date()));
    expect(await queries.isCategoryReferenced(w.groceries)).toBe(true);
    expect(await queries.isCategoryReferenced(w.restaurants)).toBe(false);
    expect(await queries.hasTransactions(w.space.spaceId)).toBe(true);
  });
});

describe("net movements of contributions and settlements (HU-E4-09, HU-E5-02)", () => {
  it("takes money out of the source and into the fund or the receiving account", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const inHousehold = (amount: bigint) => ({
      id: randomUUID() as TransactionId,
      spaceId: w.household.spaceId,
      date: "2026-10-02" as LocalDate,
      amount,
      currency: "COP",
      createdBy: w.household.userId,
      now: new Date(),
    });
    await store(
      unwrap(
        recordFundContribution({
          ...inHousehold(48_000_000n),
          payerMemberId: w.household.memberId,
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
      unwrap(
        recordFundContribution({
          ...inHousehold(10_000_000n),
          payerMemberId: w.pedro,
          sourceAccountId: null,
          destinationAccountId: w.fund,
        }),
      ),
      unwrap(
        recordSettlement({
          ...inHousehold(5_000_000n),
          payerMemberId: w.pedro,
          receivingMemberId: w.household.memberId,
          sourceAccountId: null,
          destinationAccountId: w.bank,
        }),
      ),
    );
    const net = await queries.netMovements([w.bank, w.fund], null);
    expect(net.get(w.bank)).toBe(-43_000_000n);
    expect(net.get(w.fund)).toBe(58_000_000n);
  });
});
