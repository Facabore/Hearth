import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordTransfer, type RecordTransferInput } from "./record-transfer";

/**
 * D29, section 4.1: Ana's space is COP. "Sale" leaves the source in its own currency, "Llega" reaches the destination
 * in its own currency. 1 USD = 4,000 COP on the date (so 1 COP = 0.00025 USD).
 */
const usd = (minor: bigint) => money(minor, "USD");
const RATES = { "USD>COP": "4000", "COP>USD": "0.00025" } as const;

/** COP → USD: 400,000.00 COP leaves Bancolombia, USD reaches the USD wallet. */
const copToUsd: RecordTransferInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  date: "2026-10-06" as LocalDate,
  amount: money(40_000_000n),
  sourceAccountId: ACCOUNTS.bancolombia.id,
  destinationAccountId: ACCOUNTS.usdWallet.id,
};

/** USD → COP: 100.00 USD leaves the USD wallet, COP reaches Bancolombia. */
const usdToCop: RecordTransferInput = {
  spaceId: "space-ana",
  userId: "u-ana",
  date: "2026-10-06" as LocalDate,
  amount: usd(100_00n),
  sourceAccountId: ACCOUNTS.usdWallet.id,
  destinationAccountId: ACCOUNTS.bancolombia.id,
};

describe("RecordTransfer across currencies (D29, section 4.1)", () => {
  it("COP → USD with a given destination amount: base is the amount, the destination leg is the USD it arrives", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const transfer = unwrap(
      await createRecordTransfer(deps)({ ...copToUsd, destinationAmount: usd(9_950n) }),
    );
    expect(transfer).toMatchObject({
      type: "TRANSFER",
      amount: 40_000_000n,
      currency: "COP",
      destinationAmount: 9_950n,
      destinationCurrency: "USD",
    });
    // The source is the base currency, so it keeps no leg; transfers never keep an original.
    expect("sourceAmount" in transfer).toBe(false);
    expect("originalAmount" in transfer).toBe(false);
  });

  it("COP → USD without a destination amount converts it at the date's rate", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const transfer = unwrap(await createRecordTransfer(deps)(copToUsd));
    expect(transfer).toMatchObject({
      amount: 40_000_000n,
      currency: "COP",
      destinationAmount: 100_00n,
      destinationCurrency: "USD",
    });
    expect("sourceAmount" in transfer).toBe(false);
  });

  it("requires a rate when none connects the currencies and no destination amount is given", async () => {
    const { deps } = ledgerFixture();
    expect(codeOf(await createRecordTransfer(deps)(copToUsd))).toBe("ExchangeRateRequired");
  });

  it("USD → COP: the base is what arrives, the source leg is the USD that left", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const transfer = unwrap(await createRecordTransfer(deps)(usdToCop));
    expect(transfer).toMatchObject({
      amount: 40_000_000n,
      currency: "COP",
      sourceAmount: 100_00n,
      sourceCurrency: "USD",
    });
    // The destination is the base currency, so it keeps no leg.
    expect("destinationAmount" in transfer).toBe(false);
  });

  it("USD → USD in a COP space: both legs are USD and the base comes from the rate", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const transfer = unwrap(
      await createRecordTransfer(deps)({
        ...usdToCop,
        destinationAccountId: ACCOUNTS.usdSavings.id,
      }),
    );
    expect(transfer).toMatchObject({
      amount: 40_000_000n,
      currency: "COP",
      sourceAmount: 100_00n,
      sourceCurrency: "USD",
      destinationAmount: 100_00n,
      destinationCurrency: "USD",
    });
  });

  it("rejects an amount that is not in the source account's currency", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    // Bancolombia is COP, so a USD amount leaving it is a mismatch.
    expect(codeOf(await createRecordTransfer(deps)({ ...copToUsd, amount: usd(100_00n) }))).toBe(
      "CurrencyMismatch",
    );
  });

  it("rejects a destination amount that is not in the destination account's currency", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    // The USD wallet receives USD, so a COP "Llega" is a mismatch.
    expect(codeOf(await createRecordTransfer(deps)({ ...copToUsd, destinationAmount: money(1n) }))).toBe(
      "CurrencyMismatch",
    );
  });

  it("refuses a destination amount that differs from the amount when both accounts share a currency", async () => {
    const { deps } = ledgerFixture({ rates: fakeRates(RATES) });
    const result = await createRecordTransfer(deps)({
      spaceId: "space-ana",
      userId: "u-ana",
      date: "2026-10-06" as LocalDate,
      amount: money(50_000_000n),
      destinationAmount: money(49_000_000n),
      sourceAccountId: ACCOUNTS.bancolombia.id,
      destinationAccountId: ACCOUNTS.nequi.id,
    });
    expect(codeOf(result)).toBe("InvalidTransferAmounts");
  });

  it("leaves a same-currency COP → COP transfer unchanged: base is the amount and no legs are kept", async () => {
    const { deps } = ledgerFixture();
    const transfer = unwrap(
      await createRecordTransfer(deps)({
        spaceId: "space-ana",
        userId: "u-ana",
        date: "2026-10-06" as LocalDate,
        amount: money(50_000_000n),
        sourceAccountId: ACCOUNTS.bancolombia.id,
        destinationAccountId: ACCOUNTS.nequi.id,
      }),
    );
    expect(transfer).toMatchObject({ amount: 50_000_000n, currency: "COP" });
    expect("sourceAmount" in transfer).toBe(false);
    expect("destinationAmount" in transfer).toBe(false);
    expect("sourceCurrency" in transfer).toBe(false);
    expect("destinationCurrency" in transfer).toBe(false);
  });
});
