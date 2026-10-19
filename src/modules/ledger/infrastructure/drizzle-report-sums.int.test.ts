import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { categoryFixture, sharedLedgerFixture, type SpaceFixture } from "../../../../tests/support/fixtures";
import {
  recordExpense,
  recordFundContribution,
  recordSettlement,
  recordTransfer,
  softDelete,
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
const nov1 = "2026-11-01" as LocalDate;
const nov30 = "2026-11-30" as LocalDate;
const base = (space: SpaceFixture, amount: bigint, date: string) => ({
  id: randomUUID() as TransactionId,
  spaceId: space.spaceId,
  date: date as LocalDate,
  amount,
  currency: "COP",
  createdBy: space.userId,
  now: new Date(),
});
/** An expense of `space` in `categoryId` on `date`, paid in full by `payer` and split equally among `participants`. */
const expense = (
  space: SpaceFixture,
  categoryId: string,
  date: string,
  amount: bigint,
  payer: { memberId: string | null; accountId: string | null },
  participants: readonly string[],
): Transaction => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(space, amount, date),
      categoryId,
      payments: [{ ...payer, amount }],
      shares: participants.map((memberId, index) => ({
        memberId,
        amount: parts[index]!.minor,
        splitMethod: "EQUAL" as const,
      })),
    }),
  );
};
/** `payerMemberId` pays `amount` into `fund` on `date`, from `sourceAccountId` or from outside the app (null). */
const contribution = (
  space: SpaceFixture,
  fund: string,
  date: string,
  amount: bigint,
  payerMemberId: string,
  sourceAccountId: string | null,
): Transaction =>
  unwrap(
    recordFundContribution({
      ...base(space, amount, date),
      payerMemberId,
      sourceAccountId,
      destinationAccountId: fund,
    }),
  );
const store = async (...txs: Transaction[]) => {
  for (const tx of txs) await repo.add(tx);
};
/** Rows in the adapters' order: by the joined ids (UUIDs have one length, so this is the tuple order). */
const sorted = <T>(rows: T[], key: (row: T) => string): T[] =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

describe("per-member sums for the space reports (HU-E7-02, HU-E7-03)", () => {
  it("sums each member's payments and shares per category within the dates; a fund payment counts for nobody", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const both = [ana, w.pedro];
    const utilities = await categoryFixture(db, w.household, "Utilities");
    const byAna = { memberId: ana, accountId: w.bank };
    await store(
      expense(w.household, w.groceries, "2026-11-01", pesos(300_000n), byAna, both),
      expense(
        w.household,
        w.groceries,
        "2026-11-30",
        pesos(100_000n),
        { memberId: w.pedro, accountId: null },
        both,
      ),
      expense(
        w.household,
        utilities,
        "2026-11-15",
        pesos(1_200_000n),
        { memberId: null, accountId: w.fund },
        both,
      ),
      // Review Focus 2 and D8: the days around the period and a deleted expense count for nobody.
      expense(w.household, w.groceries, "2026-10-31", pesos(70_000n), byAna, both),
      expense(w.household, w.groceries, "2026-12-01", pesos(80_000n), byAna, both),
      softDelete(expense(w.household, w.groceries, "2026-11-10", pesos(90_000n), byAna, both), new Date()),
      contribution(w.household, w.fund, "2026-11-02", pesos(480_000n), ana, w.bank),
    );
    const expected = [
      { categoryId: w.groceries, memberId: ana, paid: pesos(300_000n), consumed: pesos(200_000n) },
      { categoryId: w.groceries, memberId: w.pedro, paid: pesos(100_000n), consumed: pesos(200_000n) },
      { categoryId: utilities, memberId: ana, paid: 0n, consumed: pesos(600_000n) },
      { categoryId: utilities, memberId: w.pedro, paid: 0n, consumed: pesos(600_000n) },
    ];
    expect(await queries.memberSumsByCategory(w.household.spaceId, nov1, nov30)).toEqual(
      sorted(expected, (row) => `${row.categoryId}/${row.memberId}`),
    );
    expect(await queries.memberSumsByCategory("not-a-uuid", nov1, nov30)).toEqual([]);
  });

  it("sums each member's fund contributions within the dates, from outside the app too, and nothing else", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    await store(
      contribution(w.household, w.fund, "2026-11-02", pesos(480_000n), ana, w.bank),
      contribution(w.household, w.fund, "2026-11-03", pesos(20_000n), ana, w.bank),
      contribution(w.household, w.fund, "2026-11-30", pesos(200_000n), w.pedro, null),
      contribution(w.household, w.fund, "2026-10-31", pesos(720_000n), ana, w.bank),
      contribution(w.household, w.fund, "2026-12-01", pesos(90_000n), ana, w.bank),
      softDelete(contribution(w.household, w.fund, "2026-11-15", pesos(50_000n), ana, w.bank), new Date()),
      // HU-E4-03: a transfer without a contributing member is no contribution.
      unwrap(
        recordTransfer({
          ...base(w.household, pesos(30_000n), "2026-11-04"),
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
      // A settlement names a payer too, but it settles a debt between members: no contribution.
      unwrap(
        recordSettlement({
          ...base(w.household, pesos(60_000n), "2026-11-05"),
          payerMemberId: w.pedro,
          receivingMemberId: ana,
          sourceAccountId: null,
          destinationAccountId: null,
        }),
      ),
    );
    const expected = [
      { memberId: ana, amount: pesos(500_000n) },
      { memberId: w.pedro, amount: pesos(200_000n) },
    ];
    expect(await queries.fundContributionsByMember(w.household.spaceId, nov1, nov30)).toEqual(
      sorted(expected, (row) => row.memberId),
    );
    expect(await queries.fundContributionsByMember("not-a-uuid", nov1, nov30)).toEqual([]);
  });
});

describe("one user's sums across their places (HU-E7-04)", () => {
  it("sums the shares of the user's member rows per space and category within the dates, and no one else's", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const anaAtHome = w.personal.memberId;
    const market = await categoryFixture(db, w.personal, "Market");
    const byAnaAtHome = { memberId: anaAtHome, accountId: w.bank };
    await store(
      expense(w.personal, market, "2026-11-03", pesos(85_000n), byAnaAtHome, [anaAtHome]),
      expense(
        w.household,
        w.groceries,
        "2026-11-05",
        pesos(300_000n),
        { memberId: w.pedro, accountId: null },
        [ana, w.pedro],
      ),
      expense(
        w.household,
        w.groceries,
        "2026-11-26",
        pesos(200_000n),
        { memberId: null, accountId: w.fund },
        [ana, w.pedro],
      ),
      // Pedro's own expense, the next period's and a deleted one count for nobody here.
      expense(
        w.household,
        w.groceries,
        "2026-11-07",
        pesos(40_000n),
        { memberId: w.pedro, accountId: null },
        [w.pedro],
      ),
      expense(w.household, w.groceries, "2026-12-01", pesos(60_000n), { memberId: ana, accountId: w.bank }, [
        ana,
      ]),
      softDelete(
        expense(w.personal, market, "2026-11-04", pesos(10_000n), byAnaAtHome, [anaAtHome]),
        new Date(),
      ),
      // The day before the period is not in it (the lower bound).
      expense(w.personal, market, "2026-10-31", pesos(25_000n), byAnaAtHome, [anaAtHome]),
    );
    const expected = [
      { spaceId: w.personal.spaceId, categoryId: market, amount: pesos(85_000n) },
      { spaceId: w.household.spaceId, categoryId: w.groceries, amount: pesos(250_000n) },
    ];
    expect(await queries.consumptionByCategory([anaAtHome, ana], nov1, nov30)).toEqual(
      sorted(expected, (row) => `${row.spaceId}/${row.categoryId}`),
    );
    expect(await queries.consumptionByCategory(["not-a-uuid"], nov1, nov30)).toEqual([]);
  });

  it("sums what the user's member rows paid out, each with the part outside the app", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const anaAtHome = w.personal.memberId;
    const market = await categoryFixture(db, w.personal, "Market");
    const both = [ana, w.pedro];
    await store(
      expense(w.personal, market, "2026-11-03", pesos(85_000n), { memberId: anaAtHome, accountId: w.bank }, [
        anaAtHome,
      ]),
      expense(
        w.household,
        w.groceries,
        "2026-11-05",
        pesos(2_000_000n),
        { memberId: ana, accountId: w.bank },
        both,
      ),
      // Recorded while Ana was a guest of the space, before her claim: no account.
      expense(
        w.household,
        w.groceries,
        "2026-11-06",
        pesos(30_000n),
        { memberId: ana, accountId: null },
        both,
      ),
      // Not Ana's payments: Pedro's and the fund's.
      expense(
        w.household,
        w.groceries,
        "2026-11-07",
        pesos(300_000n),
        { memberId: w.pedro, accountId: null },
        both,
      ),
      expense(
        w.household,
        w.groceries,
        "2026-11-08",
        pesos(1_200_000n),
        { memberId: null, accountId: w.fund },
        both,
      ),
      contribution(w.household, w.fund, "2026-11-01", pesos(480_000n), ana, w.bank),
      contribution(w.household, w.fund, "2026-11-02", pesos(20_000n), ana, null),
      contribution(w.household, w.fund, "2026-12-01", pesos(99_000n), ana, w.bank),
      // D8: deleted payments and contributions of Ana count for nothing.
      softDelete(
        expense(
          w.household,
          w.groceries,
          "2026-11-10",
          pesos(40_000n),
          { memberId: ana, accountId: w.bank },
          both,
        ),
        new Date(),
      ),
      softDelete(contribution(w.household, w.fund, "2026-11-11", pesos(60_000n), ana, w.bank), new Date()),
      // A settlement names Ana as payer too, but it settles a debt between members: not cash out of hers here.
      unwrap(
        recordSettlement({
          ...base(w.household, pesos(70_000n), "2026-11-09"),
          payerMemberId: ana,
          receivingMemberId: w.pedro,
          sourceAccountId: null,
          destinationAccountId: null,
        }),
      ),
    );
    expect(await queries.cashOut([anaAtHome, ana], nov1, nov30)).toEqual({
      payments: pesos(2_115_000n),
      paymentsOutsideTheApp: pesos(30_000n),
      fundContributions: pesos(500_000n),
      contributionsOutsideTheApp: pesos(20_000n),
    });
    expect(await queries.cashOut([], nov1, nov30)).toEqual({
      payments: 0n,
      paymentsOutsideTheApp: 0n,
      fundContributions: 0n,
      contributionsOutsideTheApp: 0n,
    });
  });
});

/** A subcategory of `parentId` (HU-E3-04), copied from the parent as stored so it has every column its level needs. */
const subcategoryOf = async (space: SpaceFixture, parentId: string, name: string): Promise<string> => {
  const categories = new DrizzleCategoryRepository(tm);
  const parent = (await categories.listCategories(space.spaceId)).find((c) => c.id === parentId)!;
  const id = randomUUID() as typeof parent.id;
  await categories.addCategories([
    { ...parent, id, parentCategoryId: parent.id, name, key: null, style: null },
  ]);
  return id;
};

describe("spending in a subcategory, for the breakdown by group (HU-E7-06)", () => {
  it("keeps a subcategory's expenses under its own id, as amounts for the space and as shares for its members", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const byAna = { memberId: ana, accountId: w.bank };
    const vegetables = await subcategoryOf(w.household, w.groceries, "Vegetables");
    await store(
      expense(w.household, w.groceries, "2026-11-05", pesos(85_000n), byAna, [ana]),
      expense(w.household, vegetables, "2026-11-06", pesos(40_000n), byAna, [ana, w.pedro]),
      // A fund contribution and a transfer are no spending: neither sum counts them.
      contribution(w.household, w.fund, "2026-11-01", pesos(480_000n), ana, w.bank),
      unwrap(
        recordTransfer({
          ...base(w.household, pesos(200_000n), "2026-11-05"),
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
    );
    const household = w.household.spaceId;
    expect(await queries.expensesByCategory(household, nov1, nov30)).toEqual(
      sorted(
        [
          { categoryId: w.groceries, amount: pesos(85_000n) },
          { categoryId: vegetables, amount: pesos(40_000n) },
        ],
        (row) => row.categoryId,
      ),
    );
    expect(await queries.consumptionByCategory([ana], nov1, nov30)).toEqual(
      sorted(
        [
          { spaceId: household, categoryId: w.groceries, amount: pesos(85_000n) },
          { spaceId: household, categoryId: vegetables, amount: pesos(20_000n) },
        ],
        (row) => row.categoryId,
      ),
    );
  });
});
