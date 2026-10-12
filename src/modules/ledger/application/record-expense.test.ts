import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

const market: RecordExpenseInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Market",
  date: "2026-10-05" as LocalDate,
  categoryId: CATEGORIES.groceries.id,
  amount: money(8_500_000n),
  accountId: ACCOUNTS.bancolombia.id,
};

describe("RecordExpense (HU-E4-01)", () => {
  it("records an expense with one payment and one share for the payer", async () => {
    const { deps, store } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)(market))).toBe("ok");
    expect(store.rows).toEqual([
      expect.objectContaining({
        type: "EXPENSE",
        spaceId: "space-ana",
        amount: 8_500_000n,
        currency: "COP",
        date: "2026-10-05",
        description: "Market",
        categoryId: "cat-groceries",
        createdBy: "u-ana",
        version: 1,
        payments: [{ memberId: "member-ana", accountId: "acc-bancolombia", amount: 8_500_000n }],
        shares: [{ memberId: "member-ana", amount: 8_500_000n, splitMethod: "EQUAL" }],
      }),
    ]);
  });

  it("defaults the date to today in the space timezone", async () => {
    const { deps, store } = ledgerFixture({ clock: new FixedClock(new Date("2026-11-01T04:30:00Z")) });
    await createRecordExpense(deps)({ ...market, date: undefined });
    expect(store.rows[0]?.date).toBe("2026-10-31");
  });

  it.each([0n, -1_000_000n])("rejects the amount %s with InvalidAmount", async (minor) => {
    const { deps, store } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, amount: money(minor) }))).toBe(
      "InvalidAmount",
    );
    expect(store.rows).toEqual([]);
  });

  it("requires a category", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, categoryId: undefined }))).toBe(
      "CategoryRequired",
    );
  });

  it("rejects paying from another user's account", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, accountId: ACCOUNTS.davivienda.id }))).toBe(
      "AccountNotOwned",
    );
  });

  it("rejects an archived account (HU-E2-03)", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, accountId: ACCOUNTS.oldNequi.id }))).toBe(
      "AccountArchived",
    );
  });

  it("rejects an archived category (HU-E3-03)", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, categoryId: CATEGORIES.archived.id }))).toBe(
      "CategoryArchived",
    );
  });

  it("rejects categories of other spaces and unknown accounts", async () => {
    const { deps } = ledgerFixture();
    const record = createRecordExpense(deps);
    expect(codeOf(await record({ ...market, categoryId: CATEGORIES.juanFood.id }))).toBe("CategoryNotFound");
    expect(codeOf(await record({ ...market, accountId: "acc-unknown" }))).toBe("AccountNotFound");
  });

  it("rejects a currency other than the space currency", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, amount: money(100n, "USD") }))).toBe(
      "CurrencyMismatch",
    );
  });

  it("forbids viewers and hides other spaces", async () => {
    const viewer = ledgerFixture({ access: fakeSpaceAccess(membership({ role: "VIEWER" })) });
    expect(codeOf(await createRecordExpense(viewer.deps)(market))).toBe("InsufficientRole");
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordExpense(deps)({ ...market, userId: "u-luis" }))).toBe("SpaceNotFound");
  });

  it("rejects a date in a closed period", async () => {
    const { deps } = ledgerFixture({ closedPeriods: { isClosed: async () => true } });
    expect(codeOf(await createRecordExpense(deps)(market))).toBe("PeriodClosed");
  });
});
