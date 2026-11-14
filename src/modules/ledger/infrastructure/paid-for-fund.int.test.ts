import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { LocalDate } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { unwrap } from "../../../../tests/support/fakes";
import { sharedLedgerFixture } from "../../../../tests/support/fixtures";
import {
  payForFund,
  recordExpense,
  recordFundContribution,
  softDelete,
  type TransactionId,
} from "../domain/transaction";
import { DrizzleTransactionRepository } from "./drizzle-transaction-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleTransactionRepository(tm);

afterAll(() => pool.end());

/** D26: Ana pays 1,200,000 COP of rent for Household's fund from her Bancolombia. */
const world = async () => {
  const w = await sharedLedgerFixture(db, pool);
  const common = {
    spaceId: w.household.spaceId,
    description: "Arriendo",
    date: "2026-11-01" as LocalDate,
    amount: 120_000_000n,
    currency: "COP",
    createdBy: w.household.userId,
    occurredAt: new Date("2026-11-01T14:00:00Z"),
    timeZone: "America/Bogota",
    now: new Date("2026-11-01T14:00:00Z"),
  };
  const contribution = unwrap(
    recordFundContribution({
      ...common,
      id: randomUUID() as TransactionId,
      payerMemberId: w.household.memberId,
      sourceAccountId: w.bank,
      destinationAccountId: w.fund,
    }),
  );
  const expense = unwrap(
    recordExpense({
      ...common,
      id: randomUUID() as TransactionId,
      categoryId: w.groceries,
      payments: [{ memberId: null, accountId: w.fund, amount: 120_000_000n }],
      shares: [{ memberId: w.household.memberId, amount: 120_000_000n, splitMethod: "EQUAL" }],
    }),
  );
  return { w, pair: unwrap(payForFund(contribution, expense)) };
};

describe("an expense paid for the fund in PostgreSQL (D26, #316)", () => {
  it("stores both halves in one statement, linked both ways, and reads them back as recorded", async () => {
    const { w, pair } = await world();
    const [contribution, expense] = pair;
    await repo.add(...pair);
    expect(await repo.findById(w.household.spaceId, contribution.id)).toMatchObject({
      ...contribution,
      version: 1,
    });
    expect(await repo.findById(w.household.spaceId, expense.id)).toMatchObject({ ...expense, version: 1 });
    const { rows } = await pool.query(
      "SELECT type, linked_transaction_id FROM transactions WHERE space_id = $1 ORDER BY type",
      [w.household.spaceId],
    );
    expect(rows).toEqual([
      { type: "EXPENSE", linked_transaction_id: contribution.id },
      { type: "TRANSFER", linked_transaction_id: expense.id },
    ]);
    // A soft delete keeps the link (D8).
    expect(await repo.save(softDelete(expense, new Date()), 1)).toBe(true);
    expect(await repo.findById(w.household.spaceId, expense.id, true)).toMatchObject({
      linkedTransactionId: contribution.id,
    });
  });

  it("reads an expense and a transfer recorded without a link exactly as before: no link at all", async () => {
    const { w, pair } = await world();
    const [contribution, expense] = pair;
    await repo.add(
      { ...contribution, linkedTransactionId: undefined },
      { ...expense, linkedTransactionId: undefined },
    );
    const read = await repo.findById(w.household.spaceId, expense.id);
    expect(read).not.toHaveProperty("linkedTransactionId");
    expect(await repo.findById(w.household.spaceId, contribution.id)).not.toHaveProperty(
      "linkedTransactionId",
    );
  });

  it("refuses a link on an income or on a transfer between one's own accounts", async () => {
    const { w, pair } = await world();
    await repo.add(...pair);
    const [contribution] = pair;
    await expect(
      pool.query("UPDATE transactions SET payer_member_id = NULL WHERE id = $1", [contribution.id]),
    ).rejects.toThrow(/transactions_linked_transaction|transactions_shape/);
    await expect(
      pool.query("UPDATE transactions SET linked_transaction_id = id WHERE id = $1", [contribution.id]),
    ).rejects.toThrow(/transactions_linked_transaction/);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM transactions WHERE space_id = $1", [
      w.household.spaceId,
    ]);
    expect(rows[0].n).toBe(2);
  });
});
