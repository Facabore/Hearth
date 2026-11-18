import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  CATEGORIES,
  householdLedger,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";

/**
 * P342 (S3): Ana's space is COP; a movement is stored in its own currency, its shares too, and only an account in
 * another currency gets a leg: what it moved, given or at the day's rate (1 USD = 4.100 COP on the date).
 */
const usd = (minor: bigint) => money(minor, "USD");
const cop = (minor: bigint) => money(minor, "COP");
const RATES = { "USD>COP": "4100" } as const;

const dinner: RecordExpenseInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Dinner in USD",
  date: "2026-11-18" as LocalDate,
  categoryId: CATEGORIES.groceries.id,
  amount: usd(50_00n),
  accountId: ACCOUNTS.usdWallet.id,
};

describe("RecordExpense keeps the movement's own currency (P342)", () => {
  it("stores a USD expense paid from a USD account in USD, its share in USD, with no leg and no original", async () => {
    const { deps, store } = ledgerFixture();
    const { expense } = unwrap(await createRecordExpense(deps)(dinner));
    expect(expense).toMatchObject({ amount: 50_00n, currency: "USD" });
    expect("originalAmount" in expense).toBe(false);
    expect("originalCurrency" in expense).toBe(false);
    expect(expense.payments).toEqual([
      { memberId: "member-ana", accountId: ACCOUNTS.usdWallet.id, amount: 50_00n },
    ]);
    expect(expense.shares).toEqual([{ memberId: "member-ana", amount: 50_00n, splitMethod: "EQUAL" }]);
    expect(store.rows).toHaveLength(1);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-50_00n);
  });

  it("records what a COP account moved when it is given, with no rate needed", async () => {
    const { deps, store } = ledgerFixture();
    const { expense } = unwrap(
      await createRecordExpense(deps)({
        ...dinner,
        accountId: ACCOUNTS.bancolombia.id,
        accountAmount: cop(205_000_00n),
      }),
    );
    expect(expense).toMatchObject({ amount: 50_00n, currency: "USD" });
    expect(expense.payments[0]).toMatchObject({
      accountId: ACCOUNTS.bancolombia.id,
      amount: 50_00n,
      accountAmount: 205_000_00n,
      accountCurrency: "COP",
    });
    expect(expense.shares).toEqual([{ memberId: "member-ana", amount: 50_00n, splitMethod: "EQUAL" }]);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-205_000_00n);
  });

  it("suggests the COP account's leg from the date's rate when none is given", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const { expense } = unwrap(
      await createRecordExpense(deps)({ ...dinner, accountId: ACCOUNTS.bancolombia.id }),
    );
    expect(expense).toMatchObject({ amount: 50_00n, currency: "USD" });
    expect(expense.payments[0]).toMatchObject({ accountAmount: 205_000_00n, accountCurrency: "COP" });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-205_000_00n);
  });

  it("refuses with ExchangeRateRequired when no rate gives the COP account's leg", async () => {
    const { deps, store } = ledgerFixture();
    const result = await createRecordExpense(deps)({ ...dinner, accountId: ACCOUNTS.bancolombia.id });
    expect(codeOf(result)).toBe("ExchangeRateRequired");
    expect(store.rows).toHaveLength(0);
  });

  it("takes a sole payment's own account amount", async () => {
    const { deps } = ledgerFixture();
    const { expense } = unwrap(
      await createRecordExpense(deps)({
        ...dinner,
        accountId: undefined,
        payments: [
          {
            memberId: "member-ana",
            accountId: ACCOUNTS.bancolombia.id,
            amount: usd(50_00n),
            accountAmount: cop(200_000_00n),
          },
        ],
      }),
    );
    expect(expense.payments[0]).toMatchObject({
      amount: 50_00n,
      accountAmount: 200_000_00n,
      accountCurrency: "COP",
    });
  });

  it("refuses a payment in another currency than the movement with CurrencyMismatch", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const result = await createRecordExpense(deps)({
      ...dinner,
      accountId: undefined,
      payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: cop(205_000_00n) }],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CurrencyMismatch", details: { expected: "USD", actual: "COP" } },
    });
    expect(store.rows).toHaveLength(0);
  });

  it("refuses an account amount that is not in the account's currency with CurrencyMismatch", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const result = await createRecordExpense(deps)({
      ...dinner,
      accountId: ACCOUNTS.bancolombia.id,
      accountAmount: usd(50_00n),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CurrencyMismatch", details: { expected: "COP", actual: "USD" } },
    });
    expect(store.rows).toHaveLength(0);
  });

  it("refuses an account amount that differs from the amount on an account in the movement's currency", async () => {
    const { deps, store } = ledgerFixture();
    const result = await createRecordExpense(deps)({ ...dinner, accountAmount: usd(49_00n) });
    expect(codeOf(result)).toBe("InvalidTransferLeg");
    expect(store.rows).toHaveLength(0);
  });

  it("splits a USD expense among several payers in USD (no longer MultiCurrencyUnsupported)", async () => {
    const { deps } = householdLedger();
    const { expense } = unwrap(
      await createRecordExpense(deps)({
        ...dinner,
        spaceId: "space-household",
        categoryId: CATEGORIES.household.id,
        accountId: undefined,
        payments: [
          { memberId: "member-ana", accountId: ACCOUNTS.usdWallet.id, amount: usd(30_00n) },
          { memberId: "member-juan", accountId: null, amount: usd(20_00n) },
        ],
        split: { method: "EQUAL", participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }] },
      }),
    );
    expect(expense).toMatchObject({ amount: 50_00n, currency: "USD" });
    expect(expense.payments.map((p) => p.amount)).toEqual([30_00n, 20_00n]);
    expect(expense.shares.map((s) => [s.memberId, s.amount])).toEqual([
      ["member-ana", 25_00n],
      ["member-juan", 25_00n],
    ]);
  });

  it("still refuses a USD expense paid for a COP fund", async () => {
    const { deps, store } = householdLedger();
    const result = await createRecordExpense(deps)({
      ...dinner,
      spaceId: "space-household",
      categoryId: CATEGORIES.household.id,
      accountId: undefined,
      paidForFund: { fundAccountId: ACCOUNTS.householdFund.id, sourceAccountId: ACCOUNTS.bancolombia.id },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "MultiCurrencyUnsupported", details: { reason: "paidForFund" } },
    });
    expect(store.rows).toHaveLength(0);
  });

  it("records a COP expense in a COP space exactly as before", async () => {
    const { deps, store } = ledgerFixture();
    const { expense } = unwrap(
      await createRecordExpense(deps)({
        ...dinner,
        amount: cop(85_000_00n),
        accountId: ACCOUNTS.bancolombia.id,
      }),
    );
    expect(expense).toMatchObject({ amount: 85_000_00n, currency: "COP" });
    expect("originalAmount" in expense).toBe(false);
    expect(expense.payments).toEqual([
      { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: 85_000_00n },
    ]);
    expect(expense.shares).toEqual([{ memberId: "member-ana", amount: 85_000_00n, splitMethod: "EQUAL" }]);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-85_000_00n);
  });
});
