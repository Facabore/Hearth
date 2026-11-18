import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordIncome, type RecordIncomeInput } from "./record-income";

/** P342 (S3): an income is stored in its own currency; only a destination in another currency gets a leg. */
const usd = (minor: bigint) => money(minor, "USD");
const cop = (minor: bigint) => money(minor, "COP");
const RATES = { "USD>COP": "4100" } as const;

const salary: RecordIncomeInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  description: "Freelance in USD",
  date: "2026-11-18" as LocalDate,
  categoryId: CATEGORIES.salary.id,
  amount: usd(50_00n),
  accountId: ACCOUNTS.usdWallet.id,
};

describe("RecordIncome keeps the movement's own currency (P342)", () => {
  it("stores a USD income into a USD account in USD with no leg and no original", async () => {
    const { deps, store } = ledgerFixture();
    const income = unwrap(await createRecordIncome(deps)(salary));
    expect(income).toMatchObject({
      amount: 50_00n,
      currency: "USD",
      destinationAccountId: ACCOUNTS.usdWallet.id,
    });
    expect("originalAmount" in income).toBe(false);
    expect("destinationAmount" in income).toBe(false);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(50_00n);
  });

  it("records what a COP account received when it is given, with no rate needed", async () => {
    const { deps, store } = ledgerFixture();
    const income = unwrap(
      await createRecordIncome(deps)({
        ...salary,
        accountId: ACCOUNTS.bancolombia.id,
        accountAmount: cop(205_000_00n),
      }),
    );
    expect(income).toMatchObject({
      amount: 50_00n,
      currency: "USD",
      destinationAmount: 205_000_00n,
      destinationCurrency: "COP",
    });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(205_000_00n);
  });

  it("suggests the COP account's leg from the date's rate when none is given", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const income = unwrap(await createRecordIncome(deps)({ ...salary, accountId: ACCOUNTS.bancolombia.id }));
    expect(income).toMatchObject({ amount: 50_00n, currency: "USD", destinationAmount: 205_000_00n });
  });

  it("refuses with ExchangeRateRequired when no rate gives the COP account's leg", async () => {
    const { deps, store } = ledgerFixture();
    const result = await createRecordIncome(deps)({ ...salary, accountId: ACCOUNTS.bancolombia.id });
    expect(codeOf(result)).toBe("ExchangeRateRequired");
    expect(store.rows).toHaveLength(0);
  });

  it("refuses an account amount that is not in the account's currency with CurrencyMismatch", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const result = await createRecordIncome(deps)({
      ...salary,
      accountId: ACCOUNTS.bancolombia.id,
      accountAmount: usd(50_00n),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CurrencyMismatch", details: { expected: "COP", actual: "USD" } },
    });
    expect(store.rows).toHaveLength(0);
  });

  it("records a COP income into a COP account exactly as before", async () => {
    const { deps, store } = ledgerFixture();
    const income = unwrap(
      await createRecordIncome(deps)({
        ...salary,
        amount: cop(3_000_000_00n),
        accountId: ACCOUNTS.bancolombia.id,
      }),
    );
    expect(income).toMatchObject({ amount: 3_000_000_00n, currency: "COP" });
    expect("originalAmount" in income).toBe(false);
    expect("destinationAmount" in income).toBe(false);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(3_000_000_00n);
  });
});
