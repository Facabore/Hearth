import { describe, expect, it } from "vitest";
import type { Transaction } from "@/modules/ledger/application";
import { movementOnAccount } from "./use-case-import-writer";

const base = {
  id: "t",
  spaceId: "s",
  description: "",
  date: "2025-01-25",
  occurredAt: null,
  timeZone: null,
  amount: 2000000n,
  currency: "COP",
  createdBy: "u",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  version: 1,
};

describe("movementOnAccount (design §3.1)", () => {
  const transfer = {
    ...base,
    type: "TRANSFER",
    categoryId: null,
    sourceAccountId: "bank",
    destinationAccountId: "usd",
    payerMemberId: null,
    destinationAmount: 500n,
    destinationCurrency: "USD",
  } as unknown as Transaction;

  it("sees a transfer leaving an account with what left, and reaching one with what arrived, in its currency", () => {
    expect(movementOnAccount(transfer, "bank")).toEqual({
      accountId: "bank",
      date: "2025-01-25",
      amountMinor: 2000000n,
      kind: "TRANSFER",
    });
    expect(movementOnAccount(transfer, "usd")).toEqual({
      accountId: "usd",
      date: "2025-01-25",
      amountMinor: 500n,
      kind: "TRANSFER",
      incoming: true,
    });
    expect(movementOnAccount(transfer, "other")).toBeNull();
  });
});
