import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { sharedLedgerFixture, type SharedLedgerFixture } from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();
let w: SharedLedgerFixture;

beforeAll(async () => {
  w = await sharedLedgerFixture(db, pool);
});
afterAll(() => pool.end());

interface Row {
  readonly type: string;
  readonly categoryId?: string;
  readonly sourceAccountId?: string;
  readonly destinationAccountId?: string;
  readonly receivingMemberId?: string;
  readonly payerMemberId?: string;
}

const insert = (row: Row) =>
  pool.query(
    `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency,
       source_account_id, destination_account_id, receiving_member_id, payer_member_id, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, '', '2026-10-05', $4, 100, 'COP', $5, $6, $7, $8, $9, now(), now())`,
    [
      randomUUID(),
      w.household.spaceId,
      row.type,
      row.categoryId ?? null,
      row.sourceAccountId ?? null,
      row.destinationAccountId ?? null,
      row.receivingMemberId ?? null,
      row.payerMemberId ?? null,
      w.household.userId,
    ],
  );

describe("transactions shape for settlements (HU-E5-02)", () => {
  it("accepts a settlement between two members, with or without accounts", async () => {
    const ana = w.household.memberId;
    await expect(
      insert({ type: "SETTLEMENT", payerMemberId: w.pedro, receivingMemberId: ana }),
    ).resolves.toBeDefined();
    await expect(
      insert({ type: "SETTLEMENT", payerMemberId: ana, receivingMemberId: w.pedro, sourceAccountId: w.bank }),
    ).resolves.toBeDefined();
  });

  it("rejects a settlement without both parties or with a category", async () => {
    const ana = w.household.memberId;
    await expect(insert({ type: "SETTLEMENT", receivingMemberId: ana })).rejects.toThrow(
      /transactions_shape/,
    );
    await expect(insert({ type: "SETTLEMENT", payerMemberId: w.pedro })).rejects.toThrow(
      /transactions_shape/,
    );
    await expect(
      insert({ type: "SETTLEMENT", payerMemberId: w.pedro, receivingMemberId: ana, categoryId: w.groceries }),
    ).rejects.toThrow(/transactions_shape/);
  });

  it("rejects a member settling with themselves", async () => {
    await expect(
      insert({ type: "SETTLEMENT", payerMemberId: w.pedro, receivingMemberId: w.pedro }),
    ).rejects.toThrow(/transactions_settlement_parties/);
  });
});

describe("transactions shape for fund contributions (HU-E4-09)", () => {
  it("accepts contributions from an account and, for a guest, from outside the app", async () => {
    await expect(
      insert({
        type: "TRANSFER",
        payerMemberId: w.household.memberId,
        sourceAccountId: w.bank,
        destinationAccountId: w.fund,
      }),
    ).resolves.toBeDefined();
    await expect(
      insert({ type: "TRANSFER", payerMemberId: w.pedro, destinationAccountId: w.fund }),
    ).resolves.toBeDefined();
  });

  it("still requires a source for transfers between own accounts and no payer on expenses or incomes", async () => {
    const ana = w.household.memberId;
    await expect(insert({ type: "TRANSFER", destinationAccountId: w.fund })).rejects.toThrow(
      /transactions_shape/,
    );
    await expect(insert({ type: "EXPENSE", categoryId: w.groceries, payerMemberId: ana })).rejects.toThrow(
      /transactions_shape/,
    );
    await expect(
      insert({
        type: "INCOME",
        categoryId: w.groceries,
        destinationAccountId: w.bank,
        receivingMemberId: ana,
        payerMemberId: ana,
      }),
    ).rejects.toThrow(/transactions_shape/);
  });
});
