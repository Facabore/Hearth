import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { accountFixture, categoryFixture, personalSpaceFixture } from "../../../../tests/support/fixtures";
import {
  recordAdjustment,
  recordExpense,
  recordIncome,
  recordTransfer,
  softDelete,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const queries = new DrizzleLedgerQueries(tm);

afterAll(() => pool.end());

const FROM = "2026-08-18" as LocalDate;

/** Ana's Bancolombia, Nequi and Efectivo, her Gas and Mercado, and how she records with them. */
const world = async () => {
  const space = await personalSpaceFixture(db, pool);
  const bank = await accountFixture(db, space, "Bancolombia");
  const wallet = await accountFixture(db, space, "Nequi");
  const cash = await accountFixture(db, space, "Efectivo");
  const gas = await categoryFixture(db, space, "Gas");
  const market = await categoryFixture(db, space, "Mercado");
  const salary = await categoryFixture(db, space, "Salario");
  const common = (date: string) => ({
    id: randomUUID() as TransactionId,
    spaceId: space.spaceId,
    date: date as LocalDate,
    amount: 5_000_000n,
    currency: "COP",
    createdBy: space.userId,
    now: new Date(),
  });
  const expense = async (date: string, categoryId: string, accountId: string) => {
    const tx = unwrap(
      recordExpense({
        ...common(date),
        categoryId,
        payments: [{ memberId: space.memberId, accountId, amount: 5_000_000n }],
        shares: [{ memberId: space.memberId, amount: 5_000_000n, splitMethod: "EQUAL" }],
      }),
    );
    await repo.add(tx);
    return tx;
  };
  const income = (date: string, accountId: string) =>
    repo.add(
      unwrap(
        recordIncome({
          ...common(date),
          categoryId: salary,
          destinationAccountId: accountId,
          receivingMemberId: space.memberId,
        }),
      ),
    );
  const transfer = (date: string, source: string, destination: string) =>
    repo.add(
      unwrap(recordTransfer({ ...common(date), sourceAccountId: source, destinationAccountId: destination })),
    );
  return { space, bank, wallet, cash, gas, market, expense, income, transfer, common };
};

describe("account usage over the window (ruling P337)", () => {
  it("counts each movement once per account it moved money out of or into, since the first day", async () => {
    const w = await world();
    await w.expense("2026-11-10", w.gas, w.bank);
    await w.expense("2026-11-11", w.market, w.bank);
    await w.income("2026-11-01", w.bank);
    await w.transfer("2026-11-02", w.bank, w.wallet);
    // Before the window: not counted.
    await w.expense("2026-08-17", w.market, w.cash);

    const usage = await queries.accountUsage(w.space.userId, FROM);

    expect(usage.accounts).toEqual(
      expect.arrayContaining([
        { accountId: w.bank, uses: 4, lastUsedOn: "2026-11-11" },
        { accountId: w.wallet, uses: 1, lastUsedOn: "2026-11-02" },
      ]),
    );
    expect(usage.accounts).toHaveLength(2);
  });

  it("leaves out deleted movements and adjustments", async () => {
    const w = await world();
    const gone = await w.expense("2026-11-10", w.gas, w.cash);
    await repo.save(softDelete(gone, new Date()), gone.version);
    await repo.add(
      unwrap(recordAdjustment({ ...w.common("2026-11-12"), accountId: w.wallet, direction: "IN" })),
    );

    const usage = await queries.accountUsage(w.space.userId, FROM);

    expect(usage.accounts).toEqual([]);
    expect(usage.categories).toEqual([]);
  });

  it("answers, per expense category, the account of its latest expense", async () => {
    const w = await world();
    await w.expense("2026-10-01", w.gas, w.wallet);
    await w.expense("2026-11-05", w.gas, w.bank);
    await w.expense("2026-11-06", w.market, w.cash);

    const usage = await queries.accountUsage(w.space.userId, FROM);

    expect(usage.categories).toEqual(
      expect.arrayContaining([
        { categoryId: w.gas, accountId: w.bank },
        { categoryId: w.market, accountId: w.cash },
      ]),
    );
    expect(usage.categories).toHaveLength(2);
  });

  it("reads only the caller's own accounts", async () => {
    const w = await world();
    const other = await world();
    await other.expense("2026-11-10", other.gas, other.bank);

    const usage = await queries.accountUsage(w.space.userId, FROM);

    expect(usage.accounts).toEqual([]);
  });
});
