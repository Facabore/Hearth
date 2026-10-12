import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordIncome, type RecordIncomeInput } from "./record-income";
import { createRecordTransfer, type RecordTransferInput } from "./record-transfer";

const salary: RecordIncomeInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Salary October",
  date: "2026-10-25" as LocalDate,
  categoryId: CATEGORIES.salary.id,
  amount: money(320_000_000n),
  accountId: ACCOUNTS.bancolombia.id,
};

const toWallet: RecordTransferInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  date: "2026-10-06" as LocalDate,
  amount: money(50_000_000n),
  sourceAccountId: ACCOUNTS.bancolombia.id,
  destinationAccountId: ACCOUNTS.nequi.id,
};

describe("RecordIncome (HU-E4-02)", () => {
  it("records a salary into her account with her as receiving member", async () => {
    const { deps } = ledgerFixture();
    expect(unwrap(await createRecordIncome(deps)(salary))).toMatchObject({
      type: "INCOME",
      amount: 320_000_000n,
      destinationAccountId: "acc-bancolombia",
      receivingMemberId: "member-ana",
      categoryId: "cat-salary",
    });
  });

  it("rejects an archived account", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordIncome(deps)({ ...salary, accountId: ACCOUNTS.oldNequi.id }))).toBe(
      "AccountArchived",
    );
  });

  it("rejects an account outside the transaction's space", async () => {
    const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
    const { deps } = ledgerFixture({
      access: fakeSpaceAccess(household),
      categories: {
        find: async (spaceId, id) => (spaceId === "space-household" ? { id, archived: false } : null),
      },
    });
    expect(codeOf(await createRecordIncome(deps)({ ...salary, spaceId: "space-household" }))).toBe(
      "AccountNotInSpace",
    );
  });

  it("requires a category and a positive amount", async () => {
    const { deps } = ledgerFixture();
    const record = createRecordIncome(deps);
    expect(codeOf(await record({ ...salary, categoryId: undefined }))).toBe("CategoryRequired");
    expect(codeOf(await record({ ...salary, amount: money(0n) }))).toBe("InvalidAmount");
  });
});

describe("RecordTransfer (HU-E4-03)", () => {
  it("moves money between her accounts without a category", async () => {
    const { deps } = ledgerFixture();
    expect(unwrap(await createRecordTransfer(deps)(toWallet))).toMatchObject({
      type: "TRANSFER",
      amount: 50_000_000n,
      categoryId: null,
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-nequi",
    });
  });

  it("rejects the same account as source and destination", async () => {
    const { deps } = ledgerFixture();
    const result = await createRecordTransfer(deps)({
      ...toWallet,
      destinationAccountId: ACCOUNTS.bancolombia.id,
    });
    expect(codeOf(result)).toBe("SameAccountTransfer");
  });

  it("rejects a destination owned by another user", async () => {
    const { deps } = ledgerFixture();
    const result = await createRecordTransfer(deps)({
      ...toWallet,
      destinationAccountId: ACCOUNTS.davivienda.id,
    });
    expect(codeOf(result)).toBe("AccountNotOwned");
  });

  it("rejects archived accounts on either side", async () => {
    const { deps } = ledgerFixture();
    const transfer = createRecordTransfer(deps);
    expect(codeOf(await transfer({ ...toWallet, destinationAccountId: ACCOUNTS.oldNequi.id }))).toBe(
      "AccountArchived",
    );
    expect(codeOf(await transfer({ ...toWallet, sourceAccountId: ACCOUNTS.oldNequi.id }))).toBe(
      "AccountArchived",
    );
  });
});
