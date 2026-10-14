import { describe, expect, it } from "vitest";
import { can } from "@/modules/spaces/application";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  canModify,
  changedDebits,
  changesBetween,
  recordExpense,
  recordFundContribution,
  recordIncome,
  recordSettlement,
  recordTransfer,
  reviseTransaction,
  softDelete,
  type Expense,
  type Payment,
  type Transaction,
  type TransactionChanges,
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

  // D9: changing how much leaves an account is a debit, so the edit path checks who owns these accounts.
  it("names the accounts whose debit an edit changes, never credited ones", () => {
    const parties = { payerMemberId: "member-juan", receivingMemberId: "member-ana" };
    const settlement = (sourceAccountId: string | null) =>
      unwrap(
        recordSettlement({
          ...common,
          ...parties,
          amount: 1_000n,
          sourceAccountId,
          destinationAccountId: "acc-bancolombia",
        }),
      );
    const contribution = unwrap(
      recordFundContribution({
        ...common,
        amount: 1_000n,
        payerMemberId: "member-juan",
        sourceAccountId: "acc-davivienda",
        destinationAccountId: "acc-household-fund",
      }),
    );
    const income = unwrap(
      recordIncome({
        ...common,
        amount: 1_000n,
        categoryId: "cat-salary",
        destinationAccountId: "acc-bancolombia",
        receivingMemberId: "member-ana",
      }),
    );
    const guestPaid = unwrap(
      recordExpense({
        ...common,
        amount: 1_000n,
        categoryId: "cat-groceries",
        payments: [{ memberId: "member-pedro", accountId: null, amount: 1_000n }],
        shares: [{ memberId: "member-ana", amount: 1_000n, splitMethod: "EQUAL" }],
      }),
    );
    const debitsAfter = (before: Transaction, changes: TransactionChanges) =>
      changedDebits(before, unwrap(reviseTransaction(before, changes, later)));
    const raise = { amount: 2_000n };
    expect(debitsAfter(unwrap(personal(1_000n)), raise)).toEqual(["acc-bancolombia"]);
    expect(debitsAfter(contribution, raise)).toEqual(["acc-davivienda"]);
    expect(debitsAfter(settlement("acc-davivienda"), raise)).toEqual(["acc-davivienda"]);
    expect(debitsAfter(settlement(null), raise)).toEqual([]);
    expect(debitsAfter(income, raise)).toEqual([]);
    expect(debitsAfter(guestPaid, raise)).toEqual([]);
    expect(debitsAfter(unwrap(personal(1_000n)), { description: "Groceries" })).toEqual([]);
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

  // HU-E1-05: changing someone else's transaction mirrors the spaces matrix (money.editAny), so the two never drift.
  it.each(["OWNER", "ADMIN", "MEMBER", "VIEWER", null] as const)(
    "lets role %s change a transaction created by someone else exactly when the matrix allows money.editAny",
    (role) => {
      expect(canModify(role, "u-ana", "u-luis")).toBe(can(role, "money.editAny"));
    },
  );
});

describe("fund contributions and settlements (HU-E4-09, HU-E5-02)", () => {
  const contribution = (overrides: { payerMemberId?: string; sourceAccountId?: string | null } = {}) =>
    recordFundContribution({
      ...common,
      amount: 48_000_000n,
      payerMemberId: "member-ana",
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-household-fund",
      ...overrides,
    });
  const settlement = (overrides: { receivingMemberId?: string; amount?: bigint } = {}) =>
    recordSettlement({
      ...common,
      amount: 120_000_000n,
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      destinationAccountId: null,
      ...overrides,
    });

  it("records a contribution as a TRANSFER into the fund by the contributing member", () => {
    expect(unwrap(contribution())).toMatchObject({
      type: "TRANSFER",
      categoryId: null,
      amount: 48_000_000n,
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-household-fund",
      payerMemberId: "member-ana",
    });
  });

  it("lets a guest contribute from outside the app, without a source account", () => {
    expect(unwrap(contribution({ payerMemberId: "member-pedro", sourceAccountId: null }))).toMatchObject({
      sourceAccountId: null,
      payerMemberId: "member-pedro",
    });
  });

  it("never contributes the fund to itself", () => {
    expect(codeOf(contribution({ sourceAccountId: "acc-household-fund" }))).toBe("SameAccountTransfer");
  });

  it("records transfers between own accounts without a payer", () => {
    const own = unwrap(
      recordTransfer({ ...common, amount: 1n, sourceAccountId: "a", destinationAccountId: "b" }),
    );
    expect(own.payerMemberId).toBeNull();
  });

  it("records a settlement from the payer to the receiving member without a category", () => {
    expect(unwrap(settlement())).toEqual({
      id: "tx-1",
      spaceId: "space-ana",
      type: "SETTLEMENT",
      description: "Market",
      date: "2026-10-05",
      amount: 120_000_000n,
      currency: "COP",
      categoryId: null,
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      destinationAccountId: null,
      createdBy: "u-ana",
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      version: 1,
    });
  });

  it("rejects a member settling with themselves and non-positive amounts", () => {
    expect(codeOf(settlement({ receivingMemberId: "member-juan" }))).toBe("InvalidSettlementParties");
    expect(codeOf(settlement({ amount: 0n }))).toBe("InvalidAmount");
  });

  it("edits a settlement's amount but never gives it a category", () => {
    const recorded = unwrap(settlement());
    expect(unwrap(reviseTransaction(recorded, { amount: 50_000_000n }, later))).toMatchObject({
      type: "SETTLEMENT",
      amount: 50_000_000n,
    });
    expect(codeOf(reviseTransaction(recorded, { categoryId: "cat-groceries" }, later))).toBe(
      "SettlementHasNoCategory",
    );
  });
});

describe("fund-paid expenses (HU-E4-10, D5)", () => {
  const rentOf = (payments: Payment[]) =>
    recordExpense({
      ...common,
      amount: 100n,
      categoryId: "cat-rent",
      payments,
      shares: [{ memberId: "member-ana", amount: 100n, splitMethod: "EQUAL" }],
    });

  it("records an expense paid by the fund alone", () => {
    expect(codeOf(rentOf([{ memberId: null, accountId: "acc-fund", amount: 100n }]))).toBe("ok");
  });

  it("keeps the fund as the only payer of an expense", () => {
    const mixed = rentOf([
      { memberId: null, accountId: "acc-fund", amount: 60n },
      { memberId: "member-ana", accountId: "acc-bancolombia", amount: 40n },
    ]);
    expect(codeOf(mixed)).toBe("MixedFundPayment");
  });

  it("refuses several fund payments: the fund pays once", () => {
    const twice = rentOf([
      { memberId: null, accountId: "acc-fund", amount: 60n },
      { memberId: null, accountId: "acc-fund", amount: 40n },
    ]);
    expect(codeOf(twice)).toBe("MixedFundPayment");
    const twoFunds = rentOf([
      { memberId: null, accountId: "acc-fund", amount: 60n },
      { memberId: null, accountId: "acc-other-fund", amount: 40n },
    ]);
    expect(codeOf(twoFunds)).toBe("MixedFundPayment");
  });
});
