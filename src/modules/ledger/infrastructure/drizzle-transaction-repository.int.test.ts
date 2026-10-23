import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import {
  accountFixture,
  categoryFixture,
  personalSpaceFixture,
  sharedLedgerFixture,
  type SpaceFixture,
} from "../../../../tests/support/fixtures";
import type { AuditEntry } from "../application/ports";
import {
  changesBetween,
  recordExpense,
  recordFundContribution,
  recordIncome,
  recordSettlement,
  recordTransfer,
  softDelete,
  type Expense,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleAuditLog } from "./drizzle-audit-log";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);
const auditLog = new DrizzleAuditLog(tm);
const now = new Date("2026-10-05T15:00:00Z");

let space: SpaceFixture;
let bank: string;
let wallet: string;
let groceries: string;

beforeAll(async () => {
  space = await personalSpaceFixture(db, pool);
  bank = await accountFixture(db, space, "Bancolombia");
  wallet = await accountFixture(db, space, "Nequi");
  groceries = await categoryFixture(db, space);
});
afterAll(() => pool.end());

const common = (amount: bigint) => ({
  id: randomUUID() as TransactionId,
  spaceId: space.spaceId,
  description: "Market",
  date: "2026-10-05" as LocalDate,
  amount,
  currency: "COP",
  createdBy: space.userId,
  now,
});
const expense = (amount = 8_500_000n): Expense =>
  unwrap(
    recordExpense({
      ...common(amount),
      categoryId: groceries,
      payments: [{ memberId: space.memberId, accountId: bank, amount }],
      shares: [{ memberId: space.memberId, amount, splitMethod: "EQUAL" }],
    }),
  );

describe("DrizzleTransactionRepository", () => {
  it("round-trips an expense with its payments and shares", async () => {
    const market = expense();
    await repo.add(market);
    expect(await repo.findById(space.spaceId, market.id)).toEqual(market);
  });

  it("round-trips income and transfers", async () => {
    const salary = unwrap(
      recordIncome({
        ...common(320_000_000n),
        categoryId: groceries,
        destinationAccountId: bank,
        receivingMemberId: space.memberId,
      }),
    );
    const move = unwrap(
      recordTransfer({ ...common(50_000_000n), sourceAccountId: bank, destinationAccountId: wallet }),
    );
    await repo.add(salary);
    await repo.add(move);
    expect(await repo.findById(space.spaceId, salary.id)).toEqual(salary);
    expect(await repo.findById(space.spaceId, move.id)).toEqual(move);
  });

  it("hides other spaces, malformed ids and soft-deleted rows unless asked", async () => {
    const market = expense();
    await repo.add(market);
    const other = await personalSpaceFixture(db, pool, "Juan");
    expect(await repo.findById(other.spaceId, market.id)).toBeNull();
    expect(await repo.findById(space.spaceId, "not-a-uuid")).toBeNull();
    expect(await repo.save(softDelete(market, now), 1)).toBe(true);
    expect(await repo.findById(space.spaceId, market.id)).toBeNull();
    expect(await repo.findById(space.spaceId, market.id, true)).toMatchObject({
      id: market.id,
      version: 2,
      deletedAt: now,
    });
  });

  it("saves only from the expected version and replaces payments and shares (Review Focus 1)", async () => {
    const market = expense();
    await repo.add(market);
    const edited: Expense = {
      ...market,
      amount: 9_500_000n,
      payments: [{ ...market.payments[0]!, amount: 9_500_000n }],
      shares: [{ ...market.shares[0]!, amount: 9_500_000n }],
    };
    expect(await repo.save(edited, 1)).toBe(true);
    expect(await repo.save({ ...market, description: "stale" }, 1)).toBe(false);
    expect(await repo.findById(space.spaceId, market.id)).toEqual({ ...edited, version: 2 });
  });

  it("writes an income's and a transfer's accounts on save, so an edit moves them (ruling P186)", async () => {
    const salary = unwrap(
      recordIncome({
        ...common(320_000_000n),
        categoryId: groceries,
        destinationAccountId: bank,
        receivingMemberId: space.memberId,
      }),
    );
    const move = unwrap(
      recordTransfer({ ...common(50_000_000n), sourceAccountId: bank, destinationAccountId: wallet }),
    );
    await repo.add(salary);
    await repo.add(move);
    const movedSalary = { ...salary, destinationAccountId: wallet };
    const movedTransfer = { ...move, sourceAccountId: wallet, destinationAccountId: bank };
    expect(await repo.save(movedSalary, 1)).toBe(true);
    expect(await repo.save(movedTransfer, 1)).toBe(true);
    expect(await repo.findById(space.spaceId, salary.id)).toEqual({ ...movedSalary, version: 2 });
    expect(await repo.findById(space.spaceId, move.id)).toEqual({ ...movedTransfer, version: 2 });
  });

  it("writes a new payment account of an expense with its replaced rows", async () => {
    const market = expense();
    await repo.add(market);
    const edited: Expense = {
      ...market,
      payments: [{ ...market.payments[0]!, accountId: wallet }],
    };
    expect(await repo.save(edited, 1)).toBe(true);
    expect(await repo.findById(space.spaceId, market.id)).toEqual({ ...edited, version: 2 });
  });
});

describe("DrizzleAuditLog", () => {
  it("appends entries and lists them oldest first", async () => {
    const market = expense();
    await repo.add(market);
    const entry = (action: AuditEntry["action"], at: Date, changes: AuditEntry["changes"]): AuditEntry => ({
      id: randomUUID(),
      transactionId: market.id,
      action,
      actorUserId: space.userId,
      at,
      changes,
    });
    const deletion = entry("DELETED", new Date("2026-10-06T00:00:00Z"), {});
    const update = entry("UPDATED", new Date("2026-10-05T16:00:00Z"), {
      amount: { from: "8500000", to: "9500000" },
    });
    await auditLog.append(deletion);
    await auditLog.append(update);
    expect(await auditLog.listFor(market.id)).toEqual([update, deletion]);
    expect(await auditLog.listFor("not-a-uuid")).toEqual([]);
  });
});

describe("fund contributions and settlements (HU-E4-09, HU-E5-02)", () => {
  it("round-trips contributions from an account and from outside the app, and settlements", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const inHousehold = (amount: bigint) => ({ ...common(amount), spaceId: w.household.spaceId });
    const fromBank = unwrap(
      recordFundContribution({
        ...inHousehold(48_000_000n),
        payerMemberId: w.household.memberId,
        sourceAccountId: w.bank,
        destinationAccountId: w.fund,
      }),
    );
    const fromPedro = unwrap(
      recordFundContribution({
        ...inHousehold(10_000_000n),
        payerMemberId: w.pedro,
        sourceAccountId: null,
        destinationAccountId: w.fund,
      }),
    );
    const settleUp = unwrap(
      recordSettlement({
        ...inHousehold(5_000_000n),
        payerMemberId: w.pedro,
        receivingMemberId: w.household.memberId,
        sourceAccountId: null,
        destinationAccountId: w.bank,
      }),
    );
    for (const tx of [fromBank, fromPedro, settleUp]) {
      await repo.add(tx);
      expect(await repo.findById(w.household.spaceId, tx.id)).toEqual(tx);
    }
  });
});

describe("the audit keeps every split an edit replaces (D8, Task 0b)", () => {
  it("recovers the shares that save replaced from the audit read back from PostgreSQL", async () => {
    const w = await sharedLedgerFixture(db, pool);
    const ana = w.household.memberId;
    const before = unwrap(
      recordExpense({
        ...common(10_000_000n),
        spaceId: w.household.spaceId,
        categoryId: w.groceries,
        payments: [{ memberId: ana, accountId: w.bank, amount: 10_000_000n }],
        shares: [
          { memberId: ana, amount: 5_000_000n, splitMethod: "EQUAL" },
          { memberId: w.pedro, amount: 5_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    await repo.add(before);
    const after: Expense = {
      ...before,
      shares: [
        { memberId: ana, amount: 2_000_000n, splitMethod: "EXACT" },
        { memberId: w.pedro, amount: 8_000_000n, splitMethod: "EXACT" },
      ],
    };
    expect(await repo.save(after, 1)).toBe(true);
    await auditLog.append({
      id: randomUUID(),
      transactionId: before.id,
      action: "UPDATED",
      actorUserId: w.household.userId,
      at: now,
      changes: changesBetween(before, after),
    });
    // The rows hold the current version only; the split they replaced lives in the audit.
    expect(await repo.findById(w.household.spaceId, before.id)).toEqual({ ...after, version: 2 });
    const [entry] = await auditLog.listFor(before.id);
    expect(Object.keys(entry!.changes)).toEqual(["shares"]);
    const earlier = JSON.parse(entry!.changes.shares!.from!) as { amount: string }[];
    expect(earlier.map((s) => ({ ...s, amount: BigInt(s.amount) }))).toEqual(before.shares);
  });
});

describe("transaction time (HU-E4-14)", () => {
  it("round-trips the instant and the zone, and gives a row without them its first time", async () => {
    const at = new Date("2026-10-05T19:32:00.000Z");
    const coffee: Expense = { ...expense(1_200_000n), occurredAt: at, timeZone: "America/Bogota" };
    await repo.add(coffee);
    expect(await repo.findById(space.spaceId, coffee.id)).toEqual(coffee);
    const old = expense(1_100_000n); // as the migration leaves a row: no time
    await repo.add(old);
    expect(await repo.findById(space.spaceId, old.id)).toMatchObject({ occurredAt: null, timeZone: null });
    expect(await repo.save({ ...old, occurredAt: at, timeZone: "America/Bogota" }, old.version)).toBe(true);
    expect(await repo.findById(space.spaceId, old.id)).toMatchObject({
      occurredAt: at,
      timeZone: "America/Bogota",
      version: 2,
    });
  });

  it("refuses an instant without its zone (transactions_time_zone)", async () => {
    const market = expense(1_000_000n);
    await repo.add(market);
    await expect(
      pool.query(`UPDATE transactions SET occurred_at = now() WHERE id = $1`, [market.id]),
    ).rejects.toMatchObject({ constraint: "transactions_time_zone" });
  });
});
