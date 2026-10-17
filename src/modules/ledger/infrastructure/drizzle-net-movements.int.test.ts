import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { ok, type LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { accountFixture, categoryFixture, personalSpaceFixture } from "../../../../tests/support/fixtures";
import { heldBy } from "../../../../tests/support/locks";
import {
  recordExpense,
  recordIncome,
  recordTransfer,
  softDelete,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleLedgerQueries } from "./drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

// The writer (also the fixtures) and the reader each have their own pool, so the reader's statements are never part of
// the writer's transaction. As in production, the reader opens no transaction: every statement takes its own snapshot.
const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const { db: readerDb, pool: readerPool } = testDatabase();
const queries = new DrizzleLedgerQueries(new DrizzleTransactionManager(readerDb));

afterAll(() => Promise.all([pool.end(), readerPool.end()]));

/**
 * Runs once, right after the next statement the reader sends has finished and before it sends another one. Whatever it
 * commits lands between two statements of a read that sends several, and after the only statement of one that sends one.
 */
let afterNextStatement: (() => Promise<void>) | null = null;
/** How many statements the reader has sent so far. */
let sent = 0;
const send = readerPool.query.bind(readerPool) as (...args: unknown[]) => Promise<unknown>;
Object.assign(readerPool, {
  query: async (...args: unknown[]) => {
    sent++;
    const result = await send(...args);
    const hook = afterNextStatement;
    afterNextStatement = null;
    await hook?.();
    return result;
  },
});

/**
 * `netMovements` on the reader. Every account's figure of one read must come from one snapshot, and PostgreSQL takes
 * one snapshot per statement: so a read sends exactly one statement, however its arms are arranged.
 */
const netMovements = async (accountIds: readonly string[], asOf: LocalDate | null) => {
  const before = sent;
  const net = await queries.netMovements(accountIds, asOf);
  expect.soft(sent - before).toBe(1);
  return net;
};

/** Ana's Bancolombia and Nequi, and the movements between them, from her salary and from her groceries. */
const world = async () => {
  const space = await personalSpaceFixture(db, pool);
  const bank = await accountFixture(db, space, "Bancolombia");
  const wallet = await accountFixture(db, space, "Nequi");
  const salary = await categoryFixture(db, space, "Salary");
  const groceries = await categoryFixture(db, space, "Groceries");
  const common = (date: string, amount: bigint) => ({
    id: randomUUID() as TransactionId,
    spaceId: space.spaceId,
    date: date as LocalDate,
    amount,
    currency: "COP",
    createdBy: space.userId,
    now: new Date(),
  });
  const income = (date: string, amount: bigint) =>
    unwrap(
      recordIncome({
        ...common(date, amount),
        categoryId: salary,
        destinationAccountId: bank,
        receivingMemberId: space.memberId,
      }),
    );
  const transfer = (date: string, amount: bigint, source = bank, destination = wallet) =>
    unwrap(
      recordTransfer({ ...common(date, amount), sourceAccountId: source, destinationAccountId: destination }),
    );
  const expense = (date: string, amount: bigint, accountId: string) =>
    unwrap(
      recordExpense({
        ...common(date, amount),
        categoryId: groceries,
        payments: [{ memberId: space.memberId, accountId, amount }],
        shares: [{ memberId: space.memberId, amount, splitMethod: "EQUAL" }],
      }),
    );
  /** The net movements of Bancolombia and Nequi, in that order; an account with no movement reads as zero. */
  const figures = async (asOf: LocalDate | null = null) => {
    const net = await netMovements([bank, wallet], asOf);
    return [net.get(bank) ?? 0n, net.get(wallet) ?? 0n];
  };
  return { bank, wallet, income, transfer, expense, figures };
};

describe("net movements of several accounts come from one snapshot (HU-E2-04, HU-E2-07)", () => {
  it("shows both legs of a transfer or neither, whenever the transfer commits while the read runs", async () => {
    const w = await world();
    await repo.add(w.income("2026-10-06", 300_000_000n));

    // The transfer Bancolombia -> Nequi is written, not yet committed: it commits when told to.
    let commit: () => void = () => undefined;
    const mayCommit = new Promise<void>((resolve) => {
      commit = resolve;
    });
    let written: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      written = resolve;
    });
    const transferring = tm.run(async () => {
      await repo.add(w.transfer("2026-10-06", 50_000_000n));
      written();
      await mayCommit;
      return ok(undefined);
    });
    try {
      await heldBy({ held }, transferring);
      expect(await w.figures()).toEqual([300_000_000n, 0n]);

      // It commits right after the read's first statement: the read still sees the world as that statement did.
      afterNextStatement = async () => {
        commit();
        await transferring;
      };
      expect(await w.figures()).toEqual([300_000_000n, 0n]);
      expect(afterNextStatement).toBeNull();

      // The commit did happen: the next read sees both legs.
      expect(await w.figures()).toEqual([250_000_000n, 50_000_000n]);
    } finally {
      // Whatever failed above: leave no hook armed for the next test, and let the writer commit. Its own rejection is
      // not rethrown here, so it never masks the failure that is already propagating (`heldBy` names it better); on the
      // passing path the hook has awaited the writer already, so a rejection of it would have failed the read.
      afterNextStatement = null;
      commit();
      await transferring.catch(() => undefined);
    }
  });
});

describe("which movements count in net movements (HU-E2-04)", () => {
  it("leaves out deleted ones and those dated after asOf, as it does for payments", async () => {
    const w = await world();
    await repo.add(w.income("2026-10-01", 300_000_000n));
    await repo.add(w.transfer("2026-10-03", 50_000_000n));
    await repo.add(softDelete(w.income("2026-10-02", 7_000_000n), new Date()));
    await repo.add(softDelete(w.transfer("2026-10-04", 9_000_000n), new Date()));
    await repo.add(w.income("2026-11-03", 4_000_000n));
    await repo.add(w.transfer("2026-11-04", 3_000_000n));
    expect(await w.figures("2026-10-31" as LocalDate)).toEqual([250_000_000n, 50_000_000n]);
    expect(await w.figures()).toEqual([251_000_000n, 53_000_000n]);
  });

  /** Bancolombia: +300 +10 -50 -50 = 210 (millions of pesos); Nequi: +50 -10 -5 = 35. */
  const crossed = async () => {
    const w = await world();
    await repo.add(w.income("2026-10-01", 300_000_000n));
    await repo.add(w.transfer("2026-10-02", 50_000_000n));
    await repo.add(w.transfer("2026-10-03", 10_000_000n, w.wallet, w.bank));
    // As much as the transfer out of Bancolombia: two equal movements of one account still count twice.
    await repo.add(w.expense("2026-10-04", 50_000_000n, w.bank));
    await repo.add(w.expense("2026-10-05", 5_000_000n, w.wallet));
    return w;
  };

  it("counts every movement once, even when a transfer out and a payment of one account are equal", async () => {
    const w = await crossed();
    expect(await w.figures()).toEqual([210_000_000n, 35_000_000n]);
  });

  it("answers for the accounts asked for and no other", async () => {
    const w = await crossed();
    expect([...(await netMovements([w.bank], null))]).toEqual([[w.bank, 210_000_000n]]);
    expect([...(await netMovements([w.wallet], null))]).toEqual([[w.wallet, 35_000_000n]]);
  });
});
