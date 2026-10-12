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
  type SpaceFixture,
} from "../../../../tests/support/fixtures";
import type { AuditEntry } from "../application/ports";
import {
  recordExpense,
  recordIncome,
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
