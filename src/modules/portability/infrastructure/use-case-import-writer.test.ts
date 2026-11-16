import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "@/modules/ledger/application";
import { domainError, err, ok } from "@/shared/kernel";
import {
  createUseCaseImportWriter,
  movementOnAccount,
  type UseCaseImportWriterSources,
} from "./use-case-import-writer";

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

  it("sees a balance adjustment as a signed ADJUSTMENT of its one account, in that account's currency (design Q4)", () => {
    const out = {
      ...base,
      type: "ADJUSTMENT",
      categoryId: null,
      sourceAccountId: "bank",
      destinationAccountId: null,
    } as unknown as Transaction;
    expect(movementOnAccount(out, "bank")).toEqual({
      accountId: "bank",
      date: "2025-01-25",
      amountMinor: -2000000n,
      kind: "ADJUSTMENT",
    });
    const into = {
      ...base,
      type: "ADJUSTMENT",
      categoryId: null,
      sourceAccountId: null,
      destinationAccountId: "usd",
      destinationAmount: 500n,
      destinationCurrency: "USD",
    } as unknown as Transaction;
    expect(movementOnAccount(into, "usd")).toMatchObject({ amountMinor: 500n, kind: "ADJUSTMENT" });
    expect(movementOnAccount(into, "bank")).toBeNull();
  });
});

describe("creating an imported category (D22)", () => {
  const writerWith = (createCategory: UseCaseImportWriterSources["createCategory"]) =>
    createUseCaseImportWriter({ createCategory } as unknown as UseCaseImportWriterSources);
  const input = { spaceId: "s", userId: "u", groupId: "g", name: "Guitarra", emoji: "🎸" };

  it("creates it without its emoji when the categories module refuses the emoji as an icon", async () => {
    const createCategory = vi
      .fn()
      .mockResolvedValueOnce(err(domainError("InvalidCategoryIcon")))
      .mockResolvedValueOnce(ok({ id: "c1" }));
    expect(await writerWith(createCategory).createCategory(input)).toEqual(ok("c1"));
    expect(createCategory).toHaveBeenLastCalledWith({
      spaceId: "s",
      userId: "u",
      groupId: "g",
      name: "Guitarra",
    });
  });

  it("never retries any other refusal", async () => {
    const createCategory = vi.fn().mockResolvedValue(err(domainError("CategoryNameTaken")));
    expect(await writerWith(createCategory).createCategory(input)).toEqual(
      err(domainError("CategoryNameTaken")),
    );
    expect(createCategory).toHaveBeenCalledTimes(1);
  });
});
