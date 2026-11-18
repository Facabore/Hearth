import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { Money, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../../../tests/support/fixtures";
import { InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import type { HistoryRange } from "../application/ports";
import { recordExpense, recordSettlement, softDelete, type TransactionId } from "../domain/transaction";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const queries = new DrizzleLedgerQueries(tm);

afterAll(() => pool.end());

const open: HistoryRange = { from: null, to: null };
const base = (w: SharedLedgerFixture, date: string, minute: number, amount: bigint, currency: string) => ({
  id: randomUUID() as TransactionId,
  spaceId: w.household.spaceId,
  description: `${date} #${minute} ${currency}`,
  date: date as LocalDate,
  amount,
  currency,
  createdBy: w.household.userId,
  now: new Date(Date.UTC(2026, 9, 1, 12, minute)),
});
/** An expense in `currency`, paid in full by `payer` and split equally among `participants`. */
const expense = (
  w: SharedLedgerFixture,
  date: string,
  minute: number,
  amount: bigint,
  currency: string,
  payer: string,
  participants: readonly string[],
) => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, currency)).allocate(participants.map(() => 1)));
  return unwrap(
    recordExpense({
      ...base(w, date, minute, amount, currency),
      categoryId: w.groceries,
      payments: [{ memberId: payer, accountId: null, amount }],
      shares: participants.map((memberId, index) => ({
        memberId,
        amount: parts[index]!.minor,
        splitMethod: "EQUAL" as const,
      })),
    }),
  );
};
const settlement = (
  w: SharedLedgerFixture,
  date: string,
  minute: number,
  amount: bigint,
  currency: string,
  payerMemberId: string,
  receivingMemberId: string,
) =>
  unwrap(
    recordSettlement({
      ...base(w, date, minute, amount, currency),
      payerMemberId,
      receivingMemberId,
      sourceAccountId: null,
      destinationAccountId: null,
    }),
  );

/**
 * Ruling P342 (S4): Household (COP) where Ana pays 300.000 COP split with Pedro (10-02), Pedro pays 100 USD split with
 * Ana (10-03), Ana pays Pedro 20 USD back (10-04), Pedro pays 60 EUR split with Ana (10-05) and a deleted 9 USD expense.
 */
const fixture = async () => {
  const w = await sharedLedgerFixture(db, pool);
  const ana = w.household.memberId;
  const pedro = w.pedro;
  const memory = new InMemoryTransactions();
  const pesos = expense(w, "2026-10-02", 0, 300_000_00n, "COP", ana, [ana, pedro]);
  const dollars = expense(w, "2026-10-03", 1, 100_00n, "USD", pedro, [ana, pedro]);
  const back = settlement(w, "2026-10-04", 2, 20_00n, "USD", ana, pedro);
  const euros = expense(w, "2026-10-05", 3, 60_00n, "EUR", pedro, [ana, pedro]);
  const deleted = softDelete(expense(w, "2026-10-06", 4, 9_00n, "USD", ana, [ana, pedro]), new Date());
  for (const tx of [pesos, dollars, back, euros, deleted]) {
    await repo.add(tx);
    await memory.add(tx);
  }
  return { w, ana, pedro, memory, pesos, dollars, back, euros };
};
const byMemberThenCurrency = (a: { memberId: string; currency: string }, b: typeof a) =>
  a.memberId !== b.memberId ? (a.memberId < b.memberId ? -1 : 1) : a.currency < b.currency ? -1 : 1;

describe("balances per currency (ruling P342, S4)", () => {
  it("sums each member's totals apart per currency, never adding pesos to dollars", async () => {
    const { w, ana, pedro, memory } = await fixture();
    const zero = { paid: 0n, consumed: 0n, settledOut: 0n, settledIn: 0n };
    const expected = [
      { memberId: ana, currency: "COP", ...zero, paid: 300_000_00n, consumed: 150_000_00n },
      { memberId: ana, currency: "USD", ...zero, consumed: 50_00n, settledOut: 20_00n },
      { memberId: ana, currency: "EUR", ...zero, consumed: 30_00n },
      { memberId: pedro, currency: "COP", ...zero, consumed: 150_000_00n },
      { memberId: pedro, currency: "USD", ...zero, paid: 100_00n, consumed: 50_00n, settledIn: 20_00n },
      { memberId: pedro, currency: "EUR", ...zero, paid: 60_00n, consumed: 30_00n },
    ].sort(byMemberThenCurrency);
    expect(await queries.memberTotals(w.household.spaceId)).toEqual(expected);
    expect(await memory.memberTotals(w.household.spaceId)).toEqual(expected);
  });

  it("carries each debt movement's currency, as the in-memory twin does", async () => {
    const { w, memory, pesos, dollars, back, euros } = await fixture();
    const movements = await queries.debtMovements(w.household.spaceId);
    const currencyOf = new Map<string, string>([
      ...movements.expenses.map((e) => [e.transactionId, e.currency] as const),
      ...movements.settlements.map((s) => [s.transactionId, s.currency] as const),
    ]);
    expect(Object.fromEntries(currencyOf)).toEqual({
      [pesos.id]: "COP",
      [dollars.id]: "USD",
      [back.id]: "USD",
      [euros.id]: "EUR",
    });
    expect(movements.settlements).toEqual([expect.objectContaining({ amount: 20_00n, currency: "USD" })]);
    expect(await memory.debtMovements(w.household.spaceId)).toEqual(movements);
  });

  it("runs a member's history in the space's currency by default, and in another one when asked", async () => {
    const { w, pedro, memory, pesos, dollars, back, euros } = await fixture();
    const space = w.household.spaceId;
    const cop = await queries.memberHistory(space, pedro, open);
    expect(cop.entries.map((e) => [e.transactionId, e.change, e.balance])).toEqual([
      [pesos.id, -150_000_00n, -150_000_00n],
    ]);
    expect(await queries.memberHistory(space, pedro, open, "COP")).toEqual(cop);
    const usd = await queries.memberHistory(space, pedro, open, "USD");
    expect(usd.entries.map((e) => [e.transactionId, e.change, e.balance])).toEqual([
      [dollars.id, 50_00n, 50_00n],
      [back.id, -20_00n, 30_00n],
    ]);
    // The opening is the net in that currency alone before the range.
    const late = await queries.memberHistory(
      space,
      pedro,
      { from: "2026-10-04" as LocalDate, to: null },
      "USD",
    );
    expect([late.opening, late.entries.map((e) => e.transactionId)]).toEqual([50_00n, [back.id]]);
    const eur = await queries.memberHistory(space, pedro, open, "EUR");
    expect(eur.entries.map((e) => [e.transactionId, e.balance])).toEqual([[euros.id, 30_00n]]);
    expect(await queries.memberHistory(space, pedro, open, "JPY")).toEqual({ opening: 0n, entries: [] });
    for (const currency of [undefined, "COP", "USD", "EUR", "JPY"]) {
      expect(await memory.memberHistory(space, pedro, open, currency)).toEqual(
        await queries.memberHistory(space, pedro, open, currency),
      );
    }
  });
});
