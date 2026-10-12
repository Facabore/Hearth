import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  canModify,
  changesBetween,
  recordExpense,
  recordIncome,
  recordTransfer,
  reviseTransaction,
  softDelete,
  type Expense,
  type TransactionId,
} from "./transaction";

const now = new Date("2026-10-05T15:00:00Z");
const later = new Date("2026-10-06T09:00:00Z");
const common = {
  id: "tx-1" as TransactionId,
  spaceId: "space-ana",
  description: "Market",
  date: "2026-10-05" as LocalDate,
  currency: "COP",
  createdBy: "u-ana",
  now,
};
const personal = (amount: bigint) =>
  recordExpense({
    ...common,
    amount,
    categoryId: "cat-groceries",
    payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount }],
    shares: [{ memberId: "member-ana", amount, splitMethod: "EQUAL" }],
  });
const shared = () =>
  unwrap(
    recordExpense({
      ...common,
      amount: 30_000_000n,
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 30_000_000n }],
      shares: [
        { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
      ],
    }),
  );

describe("recording transactions", () => {
  it("records a personal expense with one payment and one share for the whole amount (HU-E4-01)", () => {
    expect(unwrap(personal(8_500_000n))).toEqual({
      id: "tx-1",
      spaceId: "space-ana",
      type: "EXPENSE",
      description: "Market",
      date: "2026-10-05",
      amount: 8_500_000n,
      currency: "COP",
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 8_500_000n }],
      shares: [{ memberId: "member-ana", amount: 8_500_000n, splitMethod: "EQUAL" }],
      createdBy: "u-ana",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
    });
  });

  it.each([0n, -1_000_000n])("rejects the amount %s", (amount) => {
    expect(codeOf(personal(amount))).toBe("InvalidAmount");
  });

  it("records the largest bigint amount exactly", () => {
    expect(unwrap(personal(9_223_372_036_854_775_807n)).amount).toBe(9_223_372_036_854_775_807n);
  });

  it("keeps payments, shares and amount equal", () => {
    const result = recordExpense({
      ...common,
      amount: 8_500_000n,
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 8_500_000n }],
      shares: [{ memberId: "member-ana", amount: 8_000_000n, splitMethod: "EQUAL" }],
    });
    expect(codeOf(result)).toBe("SharesDoNotMatchAmount");
  });

  it("requires at least one participant", () => {
    const result = recordExpense({
      ...common,
      amount: 100n,
      categoryId: "cat-groceries",
      payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 100n }],
      shares: [],
    });
    expect(codeOf(result)).toBe("ParticipantsRequired");
  });

  it("rejects descriptions longer than 200 characters", () => {
    expect(
      codeOf(
        recordTransfer({
          ...common,
          description: "x".repeat(201),
          amount: 1n,
          sourceAccountId: "a",
          destinationAccountId: "b",
        }),
      ),
    ).toBe("InvalidDescription");
  });

  it("records income into an account for the receiving member (HU-E4-02)", () => {
    const income = unwrap(
      recordIncome({
        ...common,
        amount: 320_000_000n,
        categoryId: "cat-salary",
        destinationAccountId: "acc-bancolombia",
        receivingMemberId: "member-ana",
      }),
    );
    expect(income).toMatchObject({
      type: "INCOME",
      destinationAccountId: "acc-bancolombia",
      receivingMemberId: "member-ana",
    });
  });

  it("records transfers without category and never to the same account (HU-E4-03)", () => {
    const transfer = unwrap(
      recordTransfer({
        ...common,
        amount: 50_000_000n,
        sourceAccountId: "acc-bancolombia",
        destinationAccountId: "acc-nequi",
      }),
    );
    expect(transfer).toMatchObject({ type: "TRANSFER", categoryId: null });
    expect(
      codeOf(
        recordTransfer({
          ...common,
          amount: 50_000_000n,
          sourceAccountId: "acc-bancolombia",
          destinationAccountId: "acc-bancolombia",
        }),
      ),
    ).toBe("SameAccountTransfer");
  });
});

describe("editing and deleting (HU-E4-06)", () => {
  it("lets a sole payment and share follow a new amount", () => {
    const edited = unwrap(
      reviseTransaction(unwrap(personal(8_500_000n)), { amount: 9_500_000n }, later),
    ) as Expense;
    expect(edited).toMatchObject({ amount: 9_500_000n, updatedAt: later, version: 1 });
    expect(edited.payments.map((p) => p.amount)).toEqual([9_500_000n]);
    expect(edited.shares.map((s) => s.amount)).toEqual([9_500_000n]);
  });

  it("rejects an amount that no longer matches several shares", () => {
    expect(codeOf(reviseTransaction(shared(), { amount: 32_000_000n }, later))).toBe(
      "SharesDoNotMatchAmount",
    );
  });

  it("never gives a transfer a category", () => {
    const transfer = unwrap(
      recordTransfer({ ...common, amount: 1n, sourceAccountId: "a", destinationAccountId: "b" }),
    );
    expect(codeOf(reviseTransaction(transfer, { categoryId: "cat-groceries" }, later))).toBe(
      "TransferHasNoCategory",
    );
  });

  it("describes audited changes as strings", () => {
    const before = unwrap(personal(8_500_000n));
    const after = unwrap(
      reviseTransaction(before, { amount: 9_500_000n, date: "2026-11-02" as LocalDate }, later),
    );
    expect(changesBetween(before, after)).toEqual({
      date: { from: "2026-10-05", to: "2026-11-02" },
      amount: { from: "8500000", to: "9500000" },
    });
    expect(changesBetween(before, before)).toEqual({});
  });

  it("soft-deletes by setting deletedAt", () => {
    expect(softDelete(unwrap(personal(100n)), later)).toMatchObject({ deletedAt: later, updatedAt: later });
  });

  it.each([
    ["u-ana", "OWNER", true],
    ["u-luis", "ADMIN", true],
    ["u-ana", "MEMBER", true],
    ["u-luis", "MEMBER", false],
    ["u-ana", "VIEWER", false],
    ["u-luis", null, false],
  ] as const)("lets %s with role %s change a transaction created by u-ana: %s", (userId, role, allowed) => {
    expect(canModify(role, "u-ana", userId)).toBe(allowed);
  });
});
