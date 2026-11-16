import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";
import { createRecordIncome, type RecordIncomeInput } from "./record-income";

/** D29, section 4.2: Ana's space is COP; she records a movement entered in USD. 1 USD = 4,000 COP on the date. */
const usd = (minor: bigint) => money(minor, "USD");
const RATES = { "USD>COP": "4000" } as const;

const salary: RecordIncomeInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Freelance in USD",
  date: "2026-10-25" as LocalDate,
  categoryId: CATEGORIES.salary.id,
  amount: usd(100_00n),
  accountId: ACCOUNTS.bancolombia.id,
};

const market: RecordExpenseInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Market in USD",
  date: "2026-10-05" as LocalDate,
  categoryId: CATEGORIES.groceries.id,
  amount: usd(100_00n),
  accountId: ACCOUNTS.bancolombia.id,
};

describe("RecordIncome in a foreign currency (D29, section 4.2)", () => {
  it("converts at the date's rate, keeps the original, and the base-currency account gets no leg", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const income = unwrap(await createRecordIncome(deps)(salary));
    expect(income).toMatchObject({
      amount: 40_000_000n,
      currency: "COP",
      originalAmount: 100_00n,
      originalCurrency: "USD",
      destinationAccountId: ACCOUNTS.bancolombia.id,
    });
    // The destination is a COP account, so its leg equals the base amount (no stored leg).
    expect("destinationAmount" in income).toBe(false);
  });

  it("stores the destination leg when the account holds the entered currency", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const income = unwrap(await createRecordIncome(deps)({ ...salary, accountId: ACCOUNTS.usdWallet.id }));
    expect(income).toMatchObject({
      amount: 40_000_000n,
      originalAmount: 100_00n,
      originalCurrency: "USD",
      destinationAmount: 100_00n,
    });
  });

  it("requires a converted amount when no rate connects the currencies that day", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordIncome(deps)(salary))).toBe("ExchangeRateRequired");
  });

  it("lets the bank's real converted amount win over the rate", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const income = unwrap(await createRecordIncome(deps)({ ...salary, convertedAmount: money(41_000_000n) }));
    expect(income).toMatchObject({ amount: 41_000_000n, originalAmount: 100_00n, originalCurrency: "USD" });
  });

  it("rejects a converted amount that is not in the space's base currency", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    expect(codeOf(await createRecordIncome(deps)({ ...salary, convertedAmount: usd(100_00n) }))).toBe(
      "CurrencyMismatch",
    );
  });
});

describe("RecordExpense in a foreign currency (D29, section 4.2)", () => {
  it("converts at the rate and keeps no account leg on a base-currency account", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const { expense } = unwrap(await createRecordExpense(deps)(market));
    expect(expense).toMatchObject({ amount: 40_000_000n, originalAmount: 100_00n, originalCurrency: "USD" });
    expect(expense.payments).toHaveLength(1);
    expect(expense.payments[0]).toMatchObject({ accountId: ACCOUNTS.bancolombia.id, amount: 40_000_000n });
    expect("accountAmount" in expense.payments[0]!).toBe(false);
    // Shares (D29 section 4.3) stay in the base currency.
    expect(expense.shares).toEqual([{ memberId: "member-ana", amount: 40_000_000n, splitMethod: "EQUAL" }]);
  });

  it("keeps the paying account's own-currency leg when the account holds the entered currency", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const { expense } = unwrap(
      await createRecordExpense(deps)({ ...market, accountId: ACCOUNTS.usdWallet.id }),
    );
    expect(expense).toMatchObject({ amount: 40_000_000n, originalAmount: 100_00n, originalCurrency: "USD" });
    expect(expense.payments[0]).toMatchObject({
      accountId: ACCOUNTS.usdWallet.id,
      amount: 40_000_000n,
      accountAmount: 100_00n,
    });
  });

  it("requires a converted amount with no rate, and lets a given one win", async () => {
    const { noRate } = { noRate: ledgerFixture() };
    expect(codeOf(await createRecordExpense(noRate.deps)(market))).toBe("ExchangeRateRequired");
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const { expense } = unwrap(
      await createRecordExpense(deps)({ ...market, convertedAmount: money(39_500_000n) }),
    );
    expect(expense).toMatchObject({ amount: 39_500_000n, originalAmount: 100_00n, originalCurrency: "USD" });
  });

  it("refuses a single payment that is not the entered amount, as the base path does", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const paying = (amount: ReturnType<typeof usd>) =>
      createRecordExpense(deps)({
        ...market,
        accountId: undefined,
        payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount }],
      });
    expect(codeOf(await paying(usd(50_00n)))).toBe("SharesDoNotMatchAmount");
    expect(codeOf(await paying(money(100_00n)))).toBe("CurrencyMismatch");
    expect(store.rows).toHaveLength(0);
    // The entered amount itself is the whole payment.
    expect(codeOf(await paying(usd(100_00n)))).toBe("ok");
  });

  it("refuses a foreign amount split across more than one payment", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const result = await createRecordExpense(deps)({
      ...market,
      accountId: undefined,
      payments: [
        { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: usd(60_00n) },
        { memberId: "member-x", accountId: null, amount: usd(40_00n) },
      ],
    });
    expect(codeOf(result)).toBe("MultiCurrencyUnsupported");
  });

  it("refuses a foreign amount paid for the fund", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const result = await createRecordExpense(deps)({
      ...market,
      accountId: undefined,
      paidForFund: { fundAccountId: ACCOUNTS.householdFund.id },
    });
    expect(codeOf(result)).toBe("MultiCurrencyUnsupported");
  });
});

describe("RecordExpense in the base currency is unchanged (D29)", () => {
  it("keeps no original and no leg when the amount is already in the space currency", async () => {
    const { deps } = ledgerFixture();
    const { expense } = unwrap(await createRecordExpense(deps)({ ...market, amount: money(85_000_00n) }));
    expect(expense.amount).toBe(85_000_00n);
    expect("originalAmount" in expense).toBe(false);
    expect("accountAmount" in expense.payments[0]!).toBe(false);
  });
});
