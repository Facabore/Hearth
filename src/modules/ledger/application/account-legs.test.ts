import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  CATEGORIES,
  householdLedger,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import { defineRecurrence, type RecurrenceId, type RecurrenceTemplate } from "../domain/recurrence";
import { createRecordExpense, type RecordExpenseInput } from "./record-expense";
import { createRecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome } from "./record-income";
import { occurrenceRecorders, recordOccurrence } from "./record-occurrence";
import { createRecordSettlement } from "./record-settlement";

/**
 * D29, section 4.1: an account leg is in the account's own currency whenever that currency is not the base. Ana's
 * space is COP and her wallet is USD; on 2026-11-14 1 COP = 0.00025 USD (USD→COP 4,000).
 */
const RATES = { "COP>USD": "0.00025", "USD>COP": "4000", "EUR>USD": "1.125" } as const;
const day = "2026-11-14" as LocalDate;
/** 5.000.000,00 COP, which is US$1,250.00 that day. */
const fiveMillion = money(500_000_000n);

const groceries: RecordExpenseInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  date: day,
  categoryId: CATEGORIES.groceries.id,
  amount: fiveMillion,
  accountId: ACCOUNTS.usdWallet.id,
};

describe("an amount typed in the base currency on an account in another currency (D29, 4.1)", () => {
  it("moves the USD account by the converted amount, not by the COP figure", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const { expense } = unwrap(await createRecordExpense(deps)(groceries));
    expect(expense).toMatchObject({ amount: 500_000_000n, currency: "COP" });
    expect("originalAmount" in expense).toBe(false);
    expect(expense.payments[0]).toMatchObject({ accountAmount: 125_000n, accountCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-125_000n);
  });

  it("converts a third currency straight into the account's at the EUR>USD rate, never through the space's", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    // P342: a EUR expense stays EUR; the USD wallet moves by 100 EUR at 1.125, US$112.50.
    const { expense } = unwrap(
      await createRecordExpense(deps)({ ...groceries, amount: money(100_00n, "EUR") }),
    );
    expect(expense).toMatchObject({ amount: 100_00n, currency: "EUR" });
    expect(expense.payments[0]).toMatchObject({ accountAmount: 112_50n, accountCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-112_50n);
  });

  it("refuses with ExchangeRateRequired when no rate converts the base into the account's currency", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates({}) });
    expect(codeOf(await createRecordExpense(deps)(groceries))).toBe("ExchangeRateRequired");
    expect(store.rows).toHaveLength(0);
  });

  it("stores an income's destination leg in the account's currency", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const income = unwrap(
      await createRecordIncome(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        categoryId: CATEGORIES.salary.id,
        amount: fiveMillion,
        accountId: ACCOUNTS.usdWallet.id,
      }),
    );
    expect(income).toMatchObject({ destinationAmount: 125_000n, destinationCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(125_000n);
  });

  it("stores a settlement's legs on the accounts in another currency", async () => {
    const { deps, store } = householdLedger(undefined, { rates: fakeRates(RATES) });
    const settlement = unwrap(
      await createRecordSettlement(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        date: day,
        amount: fiveMillion,
        payerMemberId: "member-ana",
        receivingMemberId: "member-juan",
        sourceAccountId: ACCOUNTS.usdWallet.id,
        destinationAccountId: ACCOUNTS.davivienda.id,
      }),
    );
    expect(settlement).toMatchObject({ sourceAmount: 125_000n, sourceCurrency: "USD" });
    expect("destinationAmount" in settlement).toBe(false);
    expect([store.netOf(ACCOUNTS.usdWallet.id), store.netOf(ACCOUNTS.davivienda.id)]).toEqual([
      -125_000n,
      500_000_000n,
    ]);
  });

  it("stores a fund contribution's source leg in the account's currency", async () => {
    const { deps, store } = householdLedger(undefined, { rates: fakeRates(RATES) });
    unwrap(
      await createRecordFundContribution(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        date: day,
        amount: fiveMillion,
        fundAccountId: ACCOUNTS.householdFund.id,
        sourceAccountId: ACCOUNTS.usdWallet.id,
      }),
    );
    expect([store.netOf(ACCOUNTS.usdWallet.id), store.netOf(ACCOUNTS.householdFund.id)]).toEqual([
      -125_000n,
      500_000_000n,
    ]);
  });

  it("stores the leg of a recurrence's occurrence paid from the USD account", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const template: RecurrenceTemplate = {
      type: "EXPENSE",
      categoryId: CATEGORIES.groceries.id,
      payer: { memberId: "member-ana", accountId: ACCOUNTS.usdWallet.id },
      split: null,
    };
    const recurrence = unwrap(
      defineRecurrence({
        id: "rec-usd" as RecurrenceId,
        spaceId: "space-ana",
        description: "Market",
        amount: 500_000_000n,
        currency: "COP",
        template,
        schedule: { kind: "MONTHLY", day: 14 },
        mode: "AUTO",
        startDate: day,
        endDate: null,
        createdBy: "u-ana",
        now: new Date("2026-10-28T17:00:00Z"),
        today: "2026-10-28" as LocalDate,
      }),
    );
    unwrap(
      await recordOccurrence(occurrenceRecorders(deps), recurrence, {
        userId: "u-ana",
        date: day,
        amount: fiveMillion,
      }),
    );
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-125_000n);
  });
});
