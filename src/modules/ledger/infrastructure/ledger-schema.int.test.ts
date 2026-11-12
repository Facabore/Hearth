import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import {
  guestMemberFixture,
  sharedLedgerFixture,
  type SharedLedgerFixture,
} from "../../../../tests/support/fixtures";

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

/** A SETTLEMENT of `spaceId` (Household unless given) from Pedro to Ana, with the P322 columns given. */
interface SettlementRow {
  readonly id?: string;
  readonly spaceId?: string;
  readonly payerMemberId?: string;
  readonly receivingMemberId?: string;
  readonly sourceAccountId?: string;
  readonly reason?: string;
  readonly onBehalfOfMemberId?: string;
  readonly linkedTransactionId?: string;
}
const settlementRow = async (row: SettlementRow) => {
  const id = row.id ?? randomUUID();
  await pool.query(
    `INSERT INTO transactions (id, space_id, type, description, date, amount, currency, payer_member_id,
       receiving_member_id, source_account_id, settlement_reason, on_behalf_of_member_id, linked_transaction_id,
       created_by, created_at, updated_at)
     VALUES ($1, $2, 'SETTLEMENT', '', '2026-10-05', 100, 'COP', $3, $4, $5, $6, $7, $8, $9, now(), now())`,
    [
      id,
      row.spaceId ?? w.household.spaceId,
      row.payerMemberId ?? w.pedro,
      row.receivingMemberId ?? w.household.memberId,
      row.sourceAccountId ?? null,
      row.reason ?? null,
      row.onBehalfOfMemberId ?? null,
      row.linkedTransactionId ?? null,
      w.household.userId,
    ],
  );
  return id;
};

describe("transactions shape for payments for someone, gifts and forgiveness (ruling P322)", () => {
  it("accepts each reason, a third member paid for and a link to a settlement of the same space", async () => {
    const third = await guestMemberFixture(pool, w.household, "Benekin");
    for (const reason of ["PAYMENT", "GIFT", "FORGIVENESS"]) {
      await expect(settlementRow({ reason })).resolves.toBeDefined();
    }
    const payment = await settlementRow({ reason: "PAYMENT", onBehalfOfMemberId: third });
    await expect(settlementRow({ reason: "GIFT", linkedTransactionId: payment })).resolves.toBeDefined();
  });

  it("rejects an unknown reason, a reason off a settlement and accounts on a GIFT or a FORGIVENESS", async () => {
    await expect(settlementRow({ reason: "LOAN" })).rejects.toThrow(/transactions_settlement_reason/);
    await expect(
      pool.query(
        `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, created_by,
           created_at, updated_at, settlement_reason)
         VALUES ($1, $2, 'EXPENSE', '', '2026-10-05', $3, 100, 'COP', $4, now(), now(), 'PAYMENT')`,
        [randomUUID(), w.household.spaceId, w.groceries, w.household.userId],
      ),
    ).rejects.toThrow(/transactions_settlement_reason/);
    for (const reason of ["GIFT", "FORGIVENESS"]) {
      const fromAna = {
        payerMemberId: w.household.memberId,
        receivingMemberId: w.pedro,
        sourceAccountId: w.bank,
      };
      await expect(settlementRow({ ...fromAna, reason })).rejects.toThrow(/transactions_settlement_reason/);
    }
  });

  it("rejects paying for a party, a member of another space and a link to itself or into another space", async () => {
    await expect(settlementRow({ onBehalfOfMemberId: w.pedro })).rejects.toThrow(/transactions_on_behalf_of/);
    const elsewhere = await sharedLedgerFixture(db, pool);
    await expect(settlementRow({ onBehalfOfMemberId: elsewhere.pedro })).rejects.toThrow(
      /transactions_on_behalf_of_member_space_fk/,
    );
    const id = randomUUID();
    await expect(settlementRow({ id, linkedTransactionId: id })).rejects.toThrow(
      /transactions_linked_transaction/,
    );
    const theirs = await settlementRow({
      spaceId: elsewhere.household.spaceId,
      payerMemberId: elsewhere.pedro,
      receivingMemberId: elsewhere.household.memberId,
    });
    await expect(settlementRow({ linkedTransactionId: theirs })).rejects.toThrow(
      /transactions_linked_transaction_space_fk/,
    );
  });
});
