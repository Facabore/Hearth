import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../../../tests/support/fixtures";
import { InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import {
  recordExpense,
  recordFundContribution,
  recordSettlement,
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
const base = (w: SharedLedgerFixture, amount: bigint) => ({
  id: randomUUID() as TransactionId,
  spaceId: w.household.spaceId,
  date: "2026-10-05" as LocalDate,
  amount,
  currency: "COP",
  createdBy: w.household.userId,
  now: new Date(),
});
/** An expense of the fixture's Household paid in full by one payer, split equally among `participants`. */
const expense = (
  w: SharedLedgerFixture,
  amount: bigint,
  payer: { memberId: string | null; accountId: string | null },
  participants: readonly string[],
) => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(w, amount),
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
/** Stores the same transactions in PostgreSQL and in the in-memory twin. */
const storeInBoth = async (memory: InMemoryTransactions, ...txs: Transaction[]) => {
  for (const tx of txs) {
    await repo.add(tx);
    await memory.add(tx);
  }
};

describe("member totals for balances (HU-E5-01)", () => {
  it("match the in-memory adapter on the same fixtures, member totals and account movements alike (Review Focus 5)", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const pedro = w.pedro;
    const memory = new InMemoryTransactions();
    await storeInBoth(
      memory,
      expense(w, pesos(300_000n), { memberId: ana, accountId: w.bank }, [ana, pedro]),
      expense(w, pesos(100_000n), { memberId: pedro, accountId: null }, [ana, pedro]),
      // D5: a fund-paid expense and a fund contribution create no debt.
      expense(w, pesos(1_200_000n), { memberId: null, accountId: w.fund }, [ana, pedro]),
      unwrap(
        recordFundContribution({
          ...base(w, pesos(480_000n)),
          payerMemberId: ana,
          sourceAccountId: w.bank,
          destinationAccountId: w.fund,
        }),
      ),
      unwrap(
        recordSettlement({
          ...base(w, pesos(50_000n)),
          payerMemberId: pedro,
          receivingMemberId: ana,
          sourceAccountId: null,
          destinationAccountId: null,
        }),
      ),
      softDelete(expense(w, pesos(999n), { memberId: ana, accountId: w.bank }, [ana, pedro]), new Date()),
      softDelete(
        unwrap(
          recordSettlement({
            ...base(w, pesos(7_000n)),
            payerMemberId: ana,
            receivingMemberId: pedro,
            sourceAccountId: null,
            destinationAccountId: null,
          }),
        ),
        new Date(),
      ),
    );
    const expected = [
      {
        memberId: ana,
        paid: pesos(300_000n),
        consumed: pesos(200_000n),
        settledOut: 0n,
        settledIn: pesos(50_000n),
      },
      {
        memberId: pedro,
        paid: pesos(100_000n),
        consumed: pesos(200_000n),
        settledOut: pesos(50_000n),
        settledIn: 0n,
      },
    ].sort((a, b) => (a.memberId < b.memberId ? -1 : 1));
    expect(await queries.memberTotals(w.household.spaceId)).toEqual(expected);
    expect(await memory.memberTotals(w.household.spaceId)).toEqual(expected);
    // Bank: −300,000 expense − 480,000 contribution; fund: −1,200,000 rent + 480,000 contribution.
    const movements = [pesos(-780_000n), pesos(-720_000n)];
    const net = await queries.netMovements([w.bank, w.fund], null);
    expect([net.get(w.bank), net.get(w.fund)]).toEqual(movements);
    expect([memory.netOf(w.bank), memory.netOf(w.fund)]).toEqual(movements);
  });

  it("ignores other spaces and returns nothing for malformed ids", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const other = await sharedLedgerFixture(db, pool);
    await repo.add(
      expense(other, pesos(10_000n), { memberId: other.household.memberId, accountId: other.bank }, [
        other.household.memberId,
        other.pedro,
      ]),
    );
    expect(await queries.memberTotals(w.household.spaceId)).toEqual([]);
    expect(await queries.memberTotals("not-a-uuid")).toEqual([]);
  });
});
