import { describe, expect, it } from "vitest";
import type { LocalDate, Money } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  CATEGORIES,
  householdLedger,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import type { Expense, Income, Settlement, Transaction, Transfer } from "../domain/transaction";
import { createEditTransaction, type EditChanges } from "./edit-transaction";
import { createRecordExpense } from "./record-expense";
import { createRecordIncome } from "./record-income";
import { createRecordSettlement } from "./record-settlement";
import { createRecordTransfer } from "./record-transfer";

/**
 * D29, section 4.1: an edit recomputes the base amount, the original and every account leg by the rules of recording.
 * Ana's space is COP and her wallet is USD; on 2026-11-14 USD→COP is 4,000.
 */
const RATES = { "COP>USD": "0.00025", "USD>COP": "4000" } as const;
const day = "2026-11-14" as LocalDate;
const usd = (minor: bigint): Money => money(minor, "USD");

const world = () => {
  const fixture = ledgerFixture({ rates: fakeRates(RATES) });
  const edit = (tx: Transaction, changes: EditChanges) =>
    createEditTransaction(fixture.deps)({
      spaceId: tx.spaceId,
      userId: "u-ana",
      transactionId: tx.id,
      expectedVersion: null,
      changes,
    });
  return { ...fixture, edit };
};

/** US$100.00 from the USD wallet: base 400.000,00 COP, original US$100.00, leg US$100.00. */
const usdMarket = async (deps: ReturnType<typeof world>["deps"]) =>
  unwrap(
    await createRecordExpense(deps)({
      spaceId: "space-ana",
      userId: "u-ana",
      date: day,
      categoryId: CATEGORIES.groceries.id,
      amount: usd(100_00n),
      accountId: ACCOUNTS.usdWallet.id,
    }),
  ).expense;

describe("editing a multi-currency expense (D29, B2)", () => {
  it("keeps the original and the legs when only the description changes", async () => {
    const { deps, store, edit } = world();
    const market = await usdMarket(deps);
    const edited = unwrap(await edit(market, { description: "Groceries" })) as Expense;
    expect(edited).toMatchObject({ amount: 40_000_000n, originalAmount: 100_00n, originalCurrency: "USD" });
    expect(edited.payments[0]).toMatchObject({ accountAmount: 100_00n, accountCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-100_00n);
  });

  it("recomputes the base, the original and the leg from a new amount in the account's currency", async () => {
    const { deps, store, edit } = world();
    const market = await usdMarket(deps);
    const edited = unwrap(await edit(market, { amount: usd(150_00n) })) as Expense;
    expect(edited).toMatchObject({ amount: 60_000_000n, originalAmount: 150_00n, originalCurrency: "USD" });
    expect(edited.payments).toEqual([
      expect.objectContaining({ amount: 60_000_000n, accountAmount: 150_00n, accountCurrency: "USD" }),
    ]);
    expect(edited.shares).toEqual([expect.objectContaining({ amount: 60_000_000n })]);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-150_00n);
  });

  it("lets the bank's converted amount win over the rate", async () => {
    const { deps, edit } = world();
    const market = await usdMarket(deps);
    const edited = unwrap(
      await edit(market, { amount: usd(150_00n), convertedAmount: money(61_000_000n) }),
    ) as Expense;
    expect(edited).toMatchObject({ amount: 61_000_000n, originalAmount: 150_00n });
    expect(edited.payments[0]).toMatchObject({ amount: 61_000_000n, accountAmount: 150_00n });
  });

  it("drops the original and converts the leg when the new amount is in the base currency", async () => {
    const { deps, store, edit } = world();
    const market = await usdMarket(deps);
    const edited = unwrap(await edit(market, { amount: money(80_000_000n) })) as Expense;
    expect(edited.amount).toBe(80_000_000n);
    expect("originalAmount" in edited).toBe(false);
    expect(edited.payments[0]).toMatchObject({ accountAmount: 200_00n, accountCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-200_00n);
  });

  it("drops the leg when the expense moves to a base-currency account", async () => {
    const { deps, store, edit } = world();
    const market = await usdMarket(deps);
    const edited = unwrap(await edit(market, { accountId: ACCOUNTS.bancolombia.id })) as Expense;
    expect("accountAmount" in edited.payments[0]!).toBe(false);
    expect([store.netOf(ACCOUNTS.usdWallet.id), store.netOf(ACCOUNTS.bancolombia.id)]).toEqual([
      0n,
      -40_000_000n,
    ]);
  });

  it("refuses a new amount with no rate for the date", async () => {
    const { deps, edit } = world();
    const market = await usdMarket(deps);
    // The rates are gone by the time of the edit.
    deps.rates.rateOn = fakeRates({}).rateOn;
    expect(codeOf(await edit(market, { amount: usd(120_00n) }))).toBe("ExchangeRateRequired");
  });
});

describe("editing the other multi-currency movements (D29, B2)", () => {
  it("recomputes an income's destination leg from a new amount", async () => {
    const { deps, store, edit } = world();
    const income = unwrap(
      await createRecordIncome(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        categoryId: CATEGORIES.salary.id,
        amount: usd(100_00n),
        accountId: ACCOUNTS.usdWallet.id,
      }),
    );
    const edited = unwrap(await edit(income, { amount: usd(250_00n) })) as Income;
    expect(edited).toMatchObject({
      amount: 100_000_000n,
      originalAmount: 250_00n,
      destinationAmount: 250_00n,
      destinationCurrency: "USD",
    });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(250_00n);
  });

  it("recomputes a cross-currency transfer's base and legs from a new Sale", async () => {
    const { deps, store, edit } = world();
    const transfer = unwrap(
      await createRecordTransfer(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        amount: money(40_000_000n),
        sourceAccountId: ACCOUNTS.bancolombia.id,
        destinationAccountId: ACCOUNTS.usdWallet.id,
      }),
    );
    const edited = unwrap(await edit(transfer, { amount: money(80_000_000n) })) as Transfer;
    expect(edited).toMatchObject({
      amount: 80_000_000n,
      destinationAmount: 200_00n,
      destinationCurrency: "USD",
    });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(200_00n);
    const arrived = unwrap(
      await edit(edited, { amount: money(80_000_000n), destinationAmount: usd(199_00n) }),
    ) as Transfer;
    expect(arrived).toMatchObject({ amount: 80_000_000n, destinationAmount: 199_00n });
  });

  it("refuses a new Sale that is not in the source account's currency", async () => {
    const { deps, edit } = world();
    const transfer = unwrap(
      await createRecordTransfer(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        amount: usd(100_00n),
        sourceAccountId: ACCOUNTS.usdWallet.id,
        destinationAccountId: ACCOUNTS.bancolombia.id,
      }),
    );
    expect(transfer).toMatchObject({ amount: 40_000_000n, sourceAmount: 100_00n });
    expect(codeOf(await edit(transfer, { amount: money(80_000_000n) }))).toBe("CurrencyMismatch");
    const edited = unwrap(await edit(transfer, { amount: usd(50_00n) })) as Transfer;
    expect(edited).toMatchObject({ amount: 20_000_000n, sourceAmount: 50_00n, sourceCurrency: "USD" });
  });

  it("recomputes a settlement's leg from a new amount", async () => {
    const { deps, store } = householdLedger(undefined, { rates: fakeRates(RATES) });
    const settlement = unwrap(
      await createRecordSettlement(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        date: day,
        amount: money(40_000_000n),
        payerMemberId: "member-ana",
        receivingMemberId: "member-juan",
        sourceAccountId: ACCOUNTS.usdWallet.id,
      }),
    );
    const edited = unwrap(
      await createEditTransaction(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        transactionId: settlement.id,
        expectedVersion: null,
        changes: { amount: money(80_000_000n) },
      }),
    ) as Settlement;
    expect(edited).toMatchObject({ amount: 80_000_000n, sourceAmount: 200_00n, sourceCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-200_00n);
  });
});
