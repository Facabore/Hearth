import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import {
  accountFixture,
  categoryFixture,
  sharedLedgerFixture,
  type SpaceFixture,
} from "../../../../tests/support/fixtures";
import { InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import {
  recordExpense,
  recordIncome,
  recordTransfer,
  type Payment,
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

const nov1 = "2026-11-01" as LocalDate;
const nov30 = "2026-11-30" as LocalDate;
const base = (space: SpaceFixture, amount: bigint, currency: string, date: string) => ({
  id: randomUUID() as TransactionId,
  spaceId: space.spaceId,
  date: date as LocalDate,
  amount,
  currency,
  createdBy: space.userId,
  now: new Date(),
});
/** An expense in `currency`, paid in full by `payment`, split equally among `participants`. */
const expense = (
  space: SpaceFixture,
  categoryId: string,
  date: string,
  amount: bigint,
  currency: string,
  payment: Omit<Payment, "amount">,
  participants: readonly string[],
): Transaction => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, currency)).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(space, amount, currency, date),
      categoryId,
      payments: [{ ...payment, amount }],
      shares: participants.map((memberId, index) => ({
        memberId,
        amount: parts[index]!.minor,
        splitMethod: "EQUAL" as const,
      })),
    }),
  );
};

/**
 * Ruling P342 (S7, owner: "Contar lo que pagó la cuenta"): Household (COP). In November Ana pays 200.000 COP of
 * groceries from Bancolombia (COP); 100 USD from Bancolombia, which moved 410.000 COP; and 30 USD from her Dollars
 * account (USD), each split equally with Pedro. Her personal space receives 1.000 USD into Bancolombia (4.100.000 COP)
 * and 500 USD into Dollars. She moves 50 USD (205.000 COP from Bancolombia) and 20 USD from Dollars into her USD savings.
 */
const fixture = async () => {
  const w = await sharedLedgerFixture(db, pool);
  const ana = w.household.memberId;
  const personalMember = w.personal.memberId;
  const dollars = await accountFixture(db, w.personal, "Dollars", 0n, "USD");
  const savings = await accountFixture(db, w.personal, "USD savings", 0n, "USD");
  const salary = await categoryFixture(db, w.personal, "Salary");
  const both = [ana, w.pedro];
  const rows = [
    expense(
      w.household,
      w.groceries,
      "2026-11-03",
      200_000_00n,
      "COP",
      { memberId: ana, accountId: w.bank },
      both,
    ),
    expense(
      w.household,
      w.groceries,
      "2026-11-04",
      100_00n,
      "USD",
      { memberId: ana, accountId: w.bank, accountAmount: 410_000_00n, accountCurrency: "COP" },
      both,
    ),
    expense(
      w.household,
      w.groceries,
      "2026-11-05",
      30_00n,
      "USD",
      { memberId: ana, accountId: dollars },
      both,
    ),
    unwrap(
      recordIncome({
        ...base(w.personal, 1_000_00n, "USD", "2026-11-06"),
        categoryId: salary,
        destinationAccountId: w.bank,
        receivingMemberId: personalMember,
        destination: { amount: 4_100_000_00n, currency: "COP" },
      }),
    ),
    unwrap(
      recordIncome({
        ...base(w.personal, 500_00n, "USD", "2026-11-07"),
        categoryId: salary,
        destinationAccountId: dollars,
        receivingMemberId: personalMember,
      }),
    ),
    unwrap(
      recordTransfer({
        ...base(w.personal, 50_00n, "USD", "2026-11-08"),
        sourceAccountId: w.bank,
        destinationAccountId: savings,
        sourceAmount: 205_000_00n,
        sourceCurrency: "COP",
      }),
    ),
    unwrap(
      recordTransfer({
        ...base(w.personal, 20_00n, "USD", "2026-11-09"),
        sourceAccountId: dollars,
        destinationAccountId: savings,
      }),
    ),
  ];
  const memory = new InMemoryTransactions();
  for (const tx of rows) {
    await repo.add(tx);
    await memory.add(tx);
  }
  return { w, ana, personalMember, savings, memory };
};

describe("Ruling P342 (S7): sums count another currency by the space-currency account leg", () => {
  it("counts a USD expense by what a COP account moved, and skips one paid from a USD account", async () => {
    const { w } = await fixture();
    const counted = [{ categoryId: w.groceries, amount: 610_000_00n }];
    expect(await queries.expensesByCategory(w.household.spaceId, nov1, nov30, "COP")).toEqual(counted);
    // Without a currency, the space's own.
    expect(await queries.expensesByCategory(w.household.spaceId, nov1, nov30)).toEqual(counted);
    expect(
      (await queries.totals({ spaceId: w.household.spaceId, from: nov1, to: nov30 }, "COP")).expenses,
    ).toBe(610_000_00n);
  });

  it("counts a USD income by what a COP account received, as the in-memory twin does", async () => {
    const { w, memory } = await fixture();
    const filter = { spaceId: w.personal.spaceId, from: nov1, to: nov30 };
    expect(await queries.totals(filter)).toEqual({ expenses: 0n, income: 4_100_000_00n });
    expect(await memory.totals(filter, "COP")).toEqual(await queries.totals(filter, "COP"));
  });

  it("counts a transfer into a USD savings account by what the COP source moved, in the plan's currency", async () => {
    const { savings } = await fixture();
    expect(await queries.transfersIntoAccounts([savings], nov1, nov30, "COP")).toEqual([
      { accountId: savings, amount: 205_000_00n },
    ]);
    // Without a currency, the receiving account's own: everything that arrived there.
    expect(await queries.transfersIntoAccounts([savings], nov1, nov30)).toEqual([
      { accountId: savings, amount: 70_00n },
    ]);
  });

  it("counts each movement for plans in its own currency, never by an account leg (P342 T6, S7)", async () => {
    const { w, savings } = await fixture();
    // Groceries: 200.000 COP, and 100 USD + 30 USD whatever account paid them.
    expect(await queries.expensesByCategoryByCurrency(w.household.spaceId, nov1, nov30)).toEqual([
      { categoryId: w.groceries, currency: "COP", amount: 200_000_00n },
      { categoryId: w.groceries, currency: "USD", amount: 130_00n },
    ]);
    // Both transfers into the USD savings are USD movements, the one paid from Bancolombia (COP) included.
    expect(await queries.transfersIntoAccountsByCurrency([savings], nov1, nov30)).toEqual([
      { accountId: savings, currency: "USD", amount: 70_00n },
    ]);
    expect(await queries.expensesByCategoryIn(w.household.spaceId, [{ start: nov1, end: nov30 }])).toEqual([
      await queries.expensesByCategoryByCurrency(w.household.spaceId, nov1, nov30),
    ]);
  });

  it("allocates the counted leg over the shares, so each member consumes their part of what the account moved", async () => {
    const { w, ana } = await fixture();
    const sums = await queries.memberSumsByCategory(w.household.spaceId, nov1, nov30, "COP");
    expect(sums).toEqual(
      [
        { categoryId: w.groceries, memberId: ana, paid: 610_000_00n, consumed: 305_000_00n },
        { categoryId: w.groceries, memberId: w.pedro, paid: 0n, consumed: 305_000_00n },
      ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1)),
    );
    expect(await queries.consumptionByCategory([ana], nov1, nov30, "COP")).toEqual([
      { spaceId: w.household.spaceId, categoryId: w.groceries, amount: 305_000_00n },
    ]);
  });

  it("sums the personal list's totals in the home currency, as the in-memory twin does", async () => {
    const { w, ana, personalMember, memory } = await fixture();
    const filter = { spaceIds: [w.household.spaceId, w.personal.spaceId], from: nov1, to: nov30 };
    const totals = await queries.memberTotalsAcross(filter, [ana, personalMember], "COP");
    expect(totals).toEqual({ share: 305_000_00n, income: 4_100_000_00n });
    expect(await memory.memberTotalsAcross(filter, [ana, personalMember], "COP")).toEqual(totals);
  });

  it("answers the unified view each movement in its own currency, never converted", async () => {
    const { w, ana } = await fixture();
    expect(await queries.consumptionByCurrency([ana], nov1, nov30)).toEqual([
      { spaceId: w.household.spaceId, categoryId: w.groceries, currency: "COP", amount: 100_000_00n },
      { spaceId: w.household.spaceId, categoryId: w.groceries, currency: "USD", amount: 65_00n },
    ]);
    expect(await queries.cashOut([ana], nov1, nov30)).toEqual([
      {
        currency: "COP",
        payments: 200_000_00n,
        paymentsOutsideTheApp: 0n,
        fundContributions: 0n,
        contributionsOutsideTheApp: 0n,
      },
      {
        currency: "USD",
        payments: 130_00n,
        paymentsOutsideTheApp: 0n,
        fundContributions: 0n,
        contributionsOutsideTheApp: 0n,
      },
    ]);
  });
});
