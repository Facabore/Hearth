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
 * P342 (S3): an edited movement stays in its own currency, and every account leg is recomputed by the rules of
 * recording. Ana's space is COP, Bancolombia is COP and her wallet is USD; on 2026-11-14 USD→COP is 4,000.
 */
const RATES = {
  "COP>USD": "0.00025",
  "USD>COP": "4000",
  "EUR>COP": "4500",
  "COP>EUR": "0.000222",
} as const;
const day = "2026-11-14" as LocalDate;
const usd = (minor: bigint): Money => money(minor, "USD");
const eur = (minor: bigint): Money => money(minor, "EUR");

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

type Deps = ReturnType<typeof world>["deps"];

/** US$100.00 charged on the COP Bancolombia: a USD expense whose payment's leg is what the bank charged. */
const usdOnBancolombia = async (deps: Deps, accountAmount?: Money) =>
  unwrap(
    await createRecordExpense(deps)({
      spaceId: "space-ana",
      userId: "u-ana",
      date: day,
      categoryId: CATEGORIES.groceries.id,
      amount: usd(100_00n),
      accountId: ACCOUNTS.bancolombia.id,
      ...(accountAmount === undefined ? {} : { accountAmount }),
    }),
  ).expense;

/** US$100.00 from the USD wallet: a USD expense with no leg. */
const usdFromWallet = async (deps: Deps) =>
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

describe("editing an expense in its own currency (P342, S3)", () => {
  it("keeps its currency and what the account moved when only the description changes", async () => {
    const { deps, store, edit } = world();
    const market = await usdOnBancolombia(deps, money(41_000_000n));
    const edited = unwrap(await edit(market, { description: "Groceries" })) as Expense;
    expect(edited).toMatchObject({ amount: 100_00n, currency: "USD" });
    expect("originalAmount" in edited).toBe(false);
    expect(edited.payments[0]).toMatchObject({ accountAmount: 41_000_000n, accountCurrency: "COP" });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-41_000_000n);
  });

  it("keeps a new amount in the expense's currency and recomputes the leg at the date's rate", async () => {
    const { deps, store, edit } = world();
    const market = await usdOnBancolombia(deps);
    const edited = unwrap(await edit(market, { amount: usd(150_00n) })) as Expense;
    expect(edited).toMatchObject({ amount: 150_00n, currency: "USD" });
    expect(edited.payments).toEqual([
      expect.objectContaining({ amount: 150_00n, accountAmount: 60_000_000n, accountCurrency: "COP" }),
    ]);
    expect(edited.shares).toEqual([expect.objectContaining({ amount: 150_00n })]);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-60_000_000n);
  });

  it("takes what the account moved when the edit types it, over the rate", async () => {
    const { deps, store, edit } = world();
    const market = await usdOnBancolombia(deps);
    const edited = unwrap(
      await edit(market, { amount: usd(150_00n), accountAmount: money(61_000_000n) }),
    ) as Expense;
    expect(edited).toMatchObject({ amount: 150_00n, currency: "USD" });
    expect(edited.payments[0]).toMatchObject({ amount: 150_00n, accountAmount: 61_000_000n });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-61_000_000n);
  });

  it("retypes what the account moved alone, keeping the amount", async () => {
    const { deps, store, edit } = world();
    const market = await usdOnBancolombia(deps);
    const edited = unwrap(await edit(market, { accountAmount: money(41_500_000n) })) as Expense;
    expect(edited).toMatchObject({ amount: 100_00n, currency: "USD" });
    expect(edited.payments[0]).toMatchObject({ amount: 100_00n, accountAmount: 41_500_000n });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-41_500_000n);
  });

  it("refuses what the account moved in another currency than the account's, or on an account in the expense's", async () => {
    const { deps, edit } = world();
    const market = await usdOnBancolombia(deps);
    expect(codeOf(await edit(market, { accountAmount: usd(99_00n) }))).toBe("CurrencyMismatch");
    const wallet = await usdFromWallet(deps);
    expect(codeOf(await edit(wallet, { accountAmount: usd(99_00n) }))).toBe("InvalidTransferLeg");
  });

  it("gives a leg at the rate when the expense moves to an account in another currency, and drops it back", async () => {
    const { deps, store, edit } = world();
    const market = await usdFromWallet(deps);
    expect("accountAmount" in market.payments[0]!).toBe(false);
    const moved = unwrap(await edit(market, { accountId: ACCOUNTS.bancolombia.id })) as Expense;
    expect(moved).toMatchObject({ amount: 100_00n, currency: "USD" });
    expect(moved.payments[0]).toMatchObject({ accountAmount: 40_000_000n, accountCurrency: "COP" });
    expect([store.netOf(ACCOUNTS.usdWallet.id), store.netOf(ACCOUNTS.bancolombia.id)]).toEqual([
      0n,
      -40_000_000n,
    ]);
    const back = unwrap(await edit(moved, { accountId: ACCOUNTS.usdWallet.id })) as Expense;
    expect("accountAmount" in back.payments[0]!).toBe(false);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-100_00n);
  });

  it("changes the currency of an expense with a sole payment and a sole share: both follow, the leg is recomputed", async () => {
    const { deps, store, audit, edit } = world();
    const market = await usdFromWallet(deps);
    const edited = unwrap(await edit(market, { amount: money(80_000_000n) })) as Expense;
    expect(edited).toMatchObject({ amount: 80_000_000n, currency: "COP" });
    expect(edited.payments).toEqual([
      expect.objectContaining({ amount: 80_000_000n, accountAmount: 200_00n, accountCurrency: "USD" }),
    ]);
    expect(edited.shares).toEqual([expect.objectContaining({ amount: 80_000_000n })]);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-200_00n);
    expect(audit.entries.at(-1)?.changes).toMatchObject({
      amount: { from: "10000", to: "80000000" },
      currency: { from: "USD", to: "COP" },
    });
  });

  it("audits a currency change of the same figure, which changes the movement", async () => {
    const { deps, audit, edit } = world();
    const market = await usdFromWallet(deps);
    deps.rates.rateOn = fakeRates({ "EUR>USD": "1.1" }).rateOn;
    const edited = unwrap(await edit(market, { amount: eur(100_00n) })) as Expense;
    expect(edited).toMatchObject({ amount: 100_00n, currency: "EUR", version: 2 });
    expect(edited.payments[0]).toMatchObject({ accountAmount: 110_00n, accountCurrency: "USD" });
    expect(audit.entries.at(-1)?.changes).toMatchObject({ currency: { from: "USD", to: "EUR" } });
  });

  it("refuses a new amount with no rate for the date when the account is in another currency", async () => {
    const { deps, edit } = world();
    const market = await usdOnBancolombia(deps);
    // The rates are gone by the time of the edit.
    deps.rates.rateOn = fakeRates({}).rateOn;
    expect(codeOf(await edit(market, { amount: usd(120_00n) }))).toBe("ExchangeRateRequired");
  });

  it("keeps a single-currency expense as it was: no leg, no conversion", async () => {
    const { deps, store, edit } = world();
    deps.rates.rateOn = fakeRates({}).rateOn;
    const { expense } = unwrap(
      await createRecordExpense(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        categoryId: CATEGORIES.groceries.id,
        amount: money(40_000_000n),
        accountId: ACCOUNTS.bancolombia.id,
      }),
    );
    const edited = unwrap(await edit(expense, { amount: money(45_000_000n) })) as Expense;
    expect(edited).toMatchObject({ amount: 45_000_000n, currency: "COP" });
    expect(edited.payments).toEqual([expect.objectContaining({ amount: 45_000_000n })]);
    expect("accountAmount" in edited.payments[0]!).toBe(false);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-45_000_000n);
    expect(codeOf(await edit(edited, { accountAmount: money(41_000_000n) }))).toBe("InvalidTransferLeg");
  });
});

describe("an expense shared in its own currency (P342, S3)", () => {
  const shared = async () => {
    const { deps, audit } = householdLedger(undefined, { rates: fakeRates(RATES) });
    const expense = unwrap(
      await createRecordExpense(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        date: day,
        categoryId: CATEGORIES.household.id,
        amount: usd(100_00n),
        // Juan paid in cash; Ana records it (P186: another member's payment needs no account of the recorder's).
        payments: [{ memberId: "member-juan", accountId: null, amount: usd(100_00n) }],
        split: {
          method: "EQUAL",
          participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }],
        },
      }),
    ).expense;
    const edit = (changes: EditChanges) =>
      createEditTransaction(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        transactionId: expense.id,
        expectedVersion: null,
        changes,
      });
    return { expense, edit, audit };
  };

  it("refuses another currency while several shares keep the old one's figures", async () => {
    const { edit, audit } = await shared();
    expect(codeOf(await edit({ amount: eur(100_00n) }))).toBe("SharesDoNotMatchAmount");
    expect(codeOf(await edit({ amount: money(40_000_000n) }))).toBe("SharesDoNotMatchAmount");
    expect(audit.entries).toHaveLength(0);
  });

  it("changes the currency when new shares are given, the sole payment following", async () => {
    const { expense, edit } = await shared();
    expect(expense.shares).toHaveLength(2);
    const edited = unwrap(
      await edit({
        amount: eur(90_00n),
        split: {
          method: "EQUAL",
          participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }],
        },
      }),
    ) as Expense;
    expect(edited).toMatchObject({ amount: 90_00n, currency: "EUR" });
    expect(edited.payments).toEqual([expect.objectContaining({ memberId: "member-juan", amount: 90_00n })]);
    expect(edited.shares.map((share) => share.amount)).toEqual([45_00n, 45_00n]);
  });

  it("keeps a new amount of the same currency on several shares only when they still add up", async () => {
    const { edit } = await shared();
    expect(codeOf(await edit({ amount: usd(120_00n) }))).toBe("SharesDoNotMatchAmount");
  });
});

describe("a movement recorded before P342, with a converted base and its original", () => {
  /** What MC3 stored: 400.000,00 COP from the USD wallet, entered as US$100.00 (its original), the wallet's leg US$100.00. */
  const legacy = async (deps: Deps): Promise<Expense> => {
    const { expense } = unwrap(
      await createRecordExpense(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        categoryId: CATEGORIES.groceries.id,
        amount: money(40_000_000n),
        accountId: ACCOUNTS.usdWallet.id,
      }),
    );
    const old = { ...expense, originalAmount: 100_00n, originalCurrency: "USD" };
    await deps.transactions.save(old, expense.version);
    return { ...old, version: expense.version + 1 };
  };

  it("keeps its base, original and leg when only the description changes", async () => {
    const { deps, store, edit } = world();
    const edited = unwrap(await edit(await legacy(deps), { description: "Groceries" })) as Expense;
    expect(edited).toMatchObject({
      amount: 40_000_000n,
      currency: "COP",
      originalAmount: 100_00n,
      originalCurrency: "USD",
    });
    expect(edited.payments[0]).toMatchObject({ accountAmount: 100_00n, accountCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-100_00n);
  });

  it("is stored in the new amount's currency, with no original, once an amount is sent", async () => {
    const { deps, store, edit } = world();
    const edited = unwrap(await edit(await legacy(deps), { amount: usd(150_00n) })) as Expense;
    expect(edited).toMatchObject({ amount: 150_00n, currency: "USD" });
    expect("originalAmount" in edited).toBe(false);
    expect("accountAmount" in edited.payments[0]!).toBe(false);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-150_00n);
  });
});

describe("editing an income in its own currency (P342, S3)", () => {
  const usdIncome = async (deps: Deps, accountId: string) =>
    unwrap(
      await createRecordIncome(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        categoryId: CATEGORIES.salary.id,
        amount: usd(100_00n),
        accountId,
      }),
    );

  it("keeps a new amount in the income's currency, with no leg on an account in it", async () => {
    const { deps, store, edit } = world();
    const income = await usdIncome(deps, ACCOUNTS.usdWallet.id);
    const edited = unwrap(await edit(income, { amount: usd(250_00n) })) as Income;
    expect(edited).toMatchObject({ amount: 250_00n, currency: "USD" });
    expect("destinationAmount" in edited).toBe(false);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(250_00n);
  });

  it("takes what the account received when typed, and changes currency with a recomputed leg", async () => {
    const { deps, store, edit } = world();
    const income = await usdIncome(deps, ACCOUNTS.bancolombia.id);
    const typed = unwrap(
      await edit(income, { amount: usd(250_00n), accountAmount: money(99_000_000n) }),
    ) as Income;
    expect(typed).toMatchObject({ amount: 250_00n, currency: "USD", destinationAmount: 99_000_000n });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(99_000_000n);
    const pesos = unwrap(await edit(typed, { amount: money(80_000_000n) })) as Income;
    expect(pesos).toMatchObject({ amount: 80_000_000n, currency: "COP" });
    expect("destinationAmount" in pesos).toBe(false);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(80_000_000n);
  });
});

describe("editing the other movements, which keep their own currency (D29, P342)", () => {
  it("recomputes a cross-currency transfer's amount and legs from a new Sale", async () => {
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
      currency: transfer.currency,
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
    const { deps, store, edit } = world();
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
    expect(codeOf(await edit(transfer, { amount: money(80_000_000n) }))).toBe("CurrencyMismatch");
    const edited = unwrap(await edit(transfer, { amount: usd(50_00n) })) as Transfer;
    expect(edited.currency).toBe(transfer.currency);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-50_00n);
  });

  it("keeps a settlement in its own currency and recomputes its leg from a new amount", async () => {
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
    const edit = (changes: EditChanges) =>
      createEditTransaction(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        transactionId: settlement.id,
        expectedVersion: null,
        changes,
      });
    const edited = unwrap(await edit({ amount: money(80_000_000n) })) as Settlement;
    expect(edited).toMatchObject({ amount: 80_000_000n, sourceAmount: 200_00n, sourceCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(-200_00n);
    expect(codeOf(await edit({ amount: usd(1_00n) }))).toBe("CurrencyMismatch");
  });
});

describe("an edit that sends only what arrived or what an account moved (D29, P342)", () => {
  const copToUsd = async (deps: Deps) =>
    unwrap(
      await createRecordTransfer(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: day,
        amount: money(40_000_000n),
        sourceAccountId: ACCOUNTS.bancolombia.id,
        destinationAccountId: ACCOUNTS.usdWallet.id,
      }),
    );

  it("applies a new arriving amount alone to a cross-currency own transfer", async () => {
    const { deps, store, edit } = world();
    const transfer = await copToUsd(deps);
    const edited = unwrap(await edit(transfer, { destinationAmount: usd(99_00n) })) as Transfer;
    expect(edited).toMatchObject({
      amount: 40_000_000n,
      destinationAmount: 99_00n,
      destinationCurrency: "USD",
    });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(99_00n);
    expect(codeOf(await edit(edited, { destinationAmount: money(1_00n) }))).toBe("CurrencyMismatch");
  });

  it("reads the deprecated converted amount as what the paying account moved", async () => {
    const { deps, edit } = world();
    const market = await usdOnBancolombia(deps);
    const edited = unwrap(await edit(market, { convertedAmount: money(41_000_000n) })) as Expense;
    expect(edited).toMatchObject({ amount: 100_00n, currency: "USD" });
    expect(edited.payments[0]).toMatchObject({ accountAmount: 41_000_000n, accountCurrency: "COP" });
  });

  it("refuses what does not fit the movement's type", async () => {
    const { deps, edit } = world();
    const market = await usdOnBancolombia(deps);
    const transfer = await copToUsd(deps);
    expect(codeOf(await edit(market, { destinationAmount: usd(1_00n) }))).toBe("InvalidTransferLeg");
    expect(codeOf(await edit(transfer, { accountAmount: money(1_00n) }))).toBe("InvalidTransferLeg");
    expect(codeOf(await edit(transfer, { convertedAmount: money(1_00n) }))).toBe("InvalidOriginalAmount");
  });

  it("refuses an account amount, a converted amount or an arriving amount on a settlement", async () => {
    const { deps } = householdLedger(undefined, { rates: fakeRates(RATES) });
    const settlement = unwrap(
      await createRecordSettlement(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        date: day,
        amount: money(40_000_000n),
        payerMemberId: "member-ana",
        receivingMemberId: "member-juan",
      }),
    );
    const edit = (changes: EditChanges) =>
      createEditTransaction(deps)({
        spaceId: "space-household",
        userId: "u-ana",
        transactionId: settlement.id,
        expectedVersion: null,
        changes,
      });
    expect(codeOf(await edit({ accountAmount: money(1_00n) }))).toBe("InvalidTransferLeg");
    expect(codeOf(await edit({ convertedAmount: money(1_00n) }))).toBe("InvalidOriginalAmount");
    expect(codeOf(await edit({ destinationAmount: money(1_00n) }))).toBe("InvalidTransferLeg");
  });
});
