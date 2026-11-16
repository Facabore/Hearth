import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, householdLedger, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createConvertTransaction } from "./convert-transaction";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction } from "./edit-transaction";
import { createRecordAdjustment, type RecordAdjustmentInput } from "./record-adjustment";
import { createRecordExpense } from "./record-expense";
import { createRecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome } from "./record-income";
import { createRecordTransfer } from "./record-transfer";
import { createRestoreTransaction } from "./restore-transaction";

/** Ana's personal space is COP; 1 USD = 4,000 COP on the date. */
const RATES = { "USD>COP": "4000", "COP>USD": "0.00025" } as const;

const adjust = (amount: bigint, overrides: Partial<RecordAdjustmentInput> = {}): RecordAdjustmentInput => ({
  spaceId: "space-ana",
  userId: "u-ana",
  date: "2026-10-06" as LocalDate,
  amount: money(amount),
  accountId: ACCOUNTS.bancolombia.id,
  ...overrides,
});

describe("RecordAdjustment (design Q4, #329)", () => {
  it("moves the account's balance by +50,000 and -20,000 COP, a net +30,000, with no category or payer", async () => {
    const { deps, store } = ledgerFixture();
    const record = createRecordAdjustment(deps);
    const inflow = unwrap(await record(adjust(5_000_000n, { description: "Cuadre" })));
    const outflow = unwrap(await record(adjust(-2_000_000n)));

    expect(inflow).toMatchObject({
      type: "ADJUSTMENT",
      amount: 5_000_000n,
      currency: "COP",
      categoryId: null,
      sourceAccountId: null,
      destinationAccountId: ACCOUNTS.bancolombia.id,
      description: "Cuadre",
    });
    expect(outflow).toMatchObject({
      type: "ADJUSTMENT",
      amount: 2_000_000n,
      sourceAccountId: ACCOUNTS.bancolombia.id,
      destinationAccountId: null,
    });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(3_000_000n);
    // In the base currency no leg is kept.
    expect("destinationAmount" in inflow || "sourceAmount" in outflow).toBe(false);
  });

  it("takes the space lock before anything else (issue #89)", async () => {
    const { deps, locks } = ledgerFixture();
    unwrap(await createRecordAdjustment(deps)(adjust(1_000n)));
    expect(locks.money).toEqual(["space-ana"]);
  });

  it("adjusts a USD account in USD: the leg is the USD entered, the base its conversion at the date's rate", async () => {
    const { deps, store } = ledgerFixture({ rates: fakeRates(RATES) });
    const usd = (minor: bigint) => money(minor, "USD");
    const record = createRecordAdjustment(deps);
    const up = unwrap(await record(adjust(0n, { accountId: ACCOUNTS.usdWallet.id, amount: usd(25_00n) })));
    expect(up).toMatchObject({
      amount: 10_000_000n,
      currency: "COP",
      destinationAccountId: ACCOUNTS.usdWallet.id,
      destinationAmount: 25_00n,
      destinationCurrency: "USD",
    });
    const down = unwrap(await record(adjust(0n, { accountId: ACCOUNTS.usdWallet.id, amount: usd(-5_00n) })));
    expect(down).toMatchObject({ sourceAmount: 5_00n, sourceCurrency: "USD" });
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(20_00n);
  });

  it("refuses an amount in another currency than the account's, and no rate for a foreign account", async () => {
    const { deps } = ledgerFixture();
    const record = createRecordAdjustment(deps);
    expect(codeOf(await record(adjust(0n, { amount: money(100n, "USD") })))).toBe("CurrencyMismatch");
    expect(
      codeOf(await record(adjust(0n, { accountId: ACCOUNTS.usdWallet.id, amount: money(100n, "USD") }))),
    ).toBe("ExchangeRateRequired");
  });

  it("refuses a zero amount, an archived account and an account of another space", async () => {
    const { deps, store } = ledgerFixture();
    const record = createRecordAdjustment(deps);
    expect(codeOf(await record(adjust(0n)))).toBe("InvalidAmount");
    expect(codeOf(await record(adjust(100n, { accountId: ACCOUNTS.oldNequi.id })))).toBe("AccountArchived");
    expect(codeOf(await record(adjust(100n, { accountId: "missing" })))).toBe("AccountNotFound");
    expect(store.rows).toHaveLength(0);
  });

  it("refuses another member's personal account (D9)", async () => {
    const { deps } = householdLedger();
    const record = createRecordAdjustment(deps);
    const theirs = adjust(100n, { spaceId: "space-household", userId: "u-juan" });
    expect(codeOf(await record(theirs))).toBe("AccountNotOwned");
  });

  it("lets an OWNER or ADMIN adjust the space's shared fund, never a MEMBER, and never a VIEWER at all", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordAdjustment(deps);
    const fund = (userId: string) =>
      adjust(-10_000n, { spaceId: "space-household", userId, accountId: ACCOUNTS.householdFund.id });
    expect(unwrap(await record(fund("u-ana")))).toMatchObject({ sourceAccountId: ACCOUNTS.householdFund.id });
    unwrap(await record(fund("u-juan")));
    expect(codeOf(await record(fund("u-luis")))).toBe("AccountNotOwned");
    expect(codeOf(await record(fund("u-sofi")))).toBe("InsufficientRole");
    expect(store.netOf(ACCOUNTS.householdFund.id)).toBe(-20_000n);
  });

  it("is deleted and restored like any movement (D8), and its balance comes and goes with it", async () => {
    const { deps, store, audit } = ledgerFixture();
    const recorded = unwrap(await createRecordAdjustment(deps)(adjust(5_000_000n)));
    const who = { spaceId: "space-ana", userId: "u-ana", transactionId: recorded.id };
    unwrap(await createDeleteTransaction(deps)(who));
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(0n);
    unwrap(await createRestoreTransaction(deps)(who));
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(5_000_000n);
    expect(audit.entries.map((e) => e.action)).toEqual(["DELETED", "RESTORED"]);
  });

  it("edits its amount, date and description, keeping its direction and its account", async () => {
    const { deps, store } = ledgerFixture();
    const recorded = unwrap(await createRecordAdjustment(deps)(adjust(-2_000_000n)));
    const edited = unwrap(
      await createEditTransaction(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        transactionId: recorded.id,
        expectedVersion: 1,
        changes: { amount: money(3_000_000n), date: "2026-10-07" as LocalDate, description: "Corrección" },
      }),
    );
    expect(edited).toMatchObject({
      type: "ADJUSTMENT",
      amount: 3_000_000n,
      date: "2026-10-07",
      description: "Corrección",
      sourceAccountId: ACCOUNTS.bancolombia.id,
      destinationAccountId: null,
    });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-3_000_000n);
  });

  it("refuses a category or another account on edit", async () => {
    const { deps } = ledgerFixture();
    const recorded = unwrap(await createRecordAdjustment(deps)(adjust(1_000n)));
    const edit = (changes: Parameters<ReturnType<typeof createEditTransaction>>[0]["changes"]) =>
      createEditTransaction(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        transactionId: recorded.id,
        expectedVersion: null,
        changes,
      });
    expect(codeOf(await edit({ categoryId: "cat-groceries" }))).toBe("AdjustmentHasNoCategory");
    expect(codeOf(await edit({ accountId: ACCOUNTS.nequi.id }))).toBe("FieldNotEditable");
  });

  it("is never converted (TransactionNotConvertible)", async () => {
    const { deps } = ledgerFixture();
    const recorded = unwrap(await createRecordAdjustment(deps)(adjust(1_000n)));
    const convert = createConvertTransaction(deps, {
      recordExpense: createRecordExpense(deps),
      recordIncome: createRecordIncome(deps),
      recordTransfer: createRecordTransfer(deps),
      recordFundContribution: createRecordFundContribution(deps),
    });
    const converted = await convert({
      spaceId: "space-ana",
      userId: "u-ana",
      transactionId: recorded.id,
      expectedVersion: null,
      to: {
        type: "TRANSFER",
        sourceAccountId: ACCOUNTS.bancolombia.id,
        destinationAccountId: ACCOUNTS.nequi.id,
        amount: money(1_000n),
      },
    });
    expect(codeOf(converted)).toBe("TransactionNotConvertible");
  });
});
