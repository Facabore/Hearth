import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeRates, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import { createRecordPairSettlement } from "./record-pair-settlement";
import { createRecordSettlement, type RecordSettlementInput } from "./record-settlement";

/**
 * P342 (S5): Household is COP; the guest Pedro owes Ana 50 USD. A settlement is stored in its own currency, and paying it
 * in another currency is an explicit exchange recorded on the recorder's account in that currency (board 3: "Saldar 50
 * USD con 205.000 COP"). On 2026-11-18 1 USD = 4.100 COP.
 */
const usd = (minor: bigint) => money(minor, "USD");
const cop = (minor: bigint) => money(minor, "COP");
const RATES = { "USD>COP": "4100" } as const;

const pedroPaysAna = (overrides: Partial<RecordSettlementInput> = {}): RecordSettlementInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  date: "2026-11-18" as LocalDate,
  amount: usd(50_00n),
  payerMemberId: "member-pedro",
  receivingMemberId: "member-ana",
  ...overrides,
});

describe("RecordSettlement in the debt's own currency (P342)", () => {
  it("settles 50 USD in USD into Ana's USD account: stored in USD, no leg, no rate needed", async () => {
    const { deps, store, locks } = householdLedger();
    const settlement = unwrap(
      await createRecordSettlement(deps)(pedroPaysAna({ destinationAccountId: ACCOUNTS.usdWallet.id })),
    );
    expect(settlement).toMatchObject({ type: "SETTLEMENT", amount: 50_00n, currency: "USD" });
    expect("destinationAmount" in settlement).toBe(false);
    expect("originalAmount" in settlement).toBe(false);
    expect(store.netOf(ACCOUNTS.usdWallet.id)).toBe(50_00n);
    // Issue #89: the space lock is taken once, before anything is read.
    expect(locks.money).toEqual(["space-household"]);
  });

  it("settles 50 USD with 205.000 COP into Ana's COP account: the settlement stays USD, the leg is COP", async () => {
    const { deps, store } = householdLedger();
    const settlement = unwrap(
      await createRecordSettlement(deps)(
        pedroPaysAna({ destinationAccountId: ACCOUNTS.bancolombia.id, destinationAmount: cop(205_000_00n) }),
      ),
    );
    expect(settlement).toMatchObject({
      amount: 50_00n,
      currency: "USD",
      destinationAccountId: ACCOUNTS.bancolombia.id,
      destinationAmount: 205_000_00n,
      destinationCurrency: "COP",
    });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(205_000_00n);
  });

  it("refuses with ExchangeAccountRequired to settle in COP without an account of Ana's in COP", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordSettlement(deps);
    const noAccount = await record(pedroPaysAna({ destinationAmount: cop(205_000_00n) }));
    expect(noAccount).toMatchObject({
      ok: false,
      error: { code: "ExchangeAccountRequired", details: { currency: "COP" } },
    });
    const usdAccount = await record(
      pedroPaysAna({ destinationAccountId: ACCOUNTS.usdWallet.id, destinationAmount: cop(205_000_00n) }),
    );
    expect(codeOf(usdAccount)).toBe("ExchangeAccountRequired");
    expect(store.rows).toEqual([]);
  });

  it("refuses with ExchangeAccountRequired an exchange recorded on an account that is not the recorder's", async () => {
    const { deps, store } = householdLedger();
    // Juan records that he paid Ana 50 USD and says what reached Ana's COP account: that leg is Ana's to state.
    const result = await createRecordSettlement(deps)(
      pedroPaysAna({
        userId: "u-juan",
        payerMemberId: "member-juan",
        destinationAccountId: ACCOUNTS.bancolombia.id,
        destinationAmount: cop(205_000_00n),
      }),
    );
    expect(codeOf(result)).toBe("ExchangeAccountRequired");
    expect(store.rows).toEqual([]);
  });

  it("records the payer's own exchange on their source account (Ana pays Juan 50 USD from her COP account)", async () => {
    const { deps, store } = householdLedger();
    const settlement = unwrap(
      await createRecordSettlement(deps)(
        pedroPaysAna({
          payerMemberId: "member-ana",
          receivingMemberId: "member-juan",
          sourceAccountId: ACCOUNTS.bancolombia.id,
          sourceAmount: cop(206_000_00n),
        }),
      ),
    );
    expect(settlement).toMatchObject({
      amount: 50_00n,
      currency: "USD",
      sourceAmount: 206_000_00n,
      sourceCurrency: "COP",
    });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-206_000_00n);
  });

  it("suggests the COP leg from the date's rate when no leg is given, and refuses without a rate", async () => {
    const withRate = householdLedger(undefined, { rates: fakeRates(RATES) });
    const settlement = unwrap(
      await createRecordSettlement(withRate.deps)(
        pedroPaysAna({ destinationAccountId: ACCOUNTS.bancolombia.id }),
      ),
    );
    expect(settlement).toMatchObject({
      currency: "USD",
      destinationAmount: 205_000_00n,
      destinationCurrency: "COP",
    });
    const noRate = householdLedger();
    const refused = await createRecordSettlement(noRate.deps)(
      pedroPaysAna({ destinationAccountId: ACCOUNTS.bancolombia.id }),
    );
    expect(codeOf(refused)).toBe("ExchangeRateRequired");
    expect(noRate.store.rows).toEqual([]);
  });

  it("refuses a leg in the settlement's own currency that is not its amount (InvalidTransferLeg)", async () => {
    const { deps, store } = householdLedger();
    const result = await createRecordSettlement(deps)(
      pedroPaysAna({ destinationAccountId: ACCOUNTS.usdWallet.id, destinationAmount: usd(49_00n) }),
    );
    expect(codeOf(result)).toBe("InvalidTransferLeg");
    expect(store.rows).toEqual([]);
  });

  it("keeps a gift for someone in one currency: both halves USD, the gift with no leg (P322)", async () => {
    const { deps, store } = householdLedger();
    const payment = unwrap(
      await createRecordSettlement(deps)(
        pedroPaysAna({
          userId: "u-juan",
          payerMemberId: "member-juan",
          onBehalfOfMemberId: "member-pedro",
          gift: true,
        }),
      ),
    );
    expect(payment).toMatchObject({ currency: "USD", amount: 50_00n, onBehalfOfMemberId: "member-pedro" });
    expect(store.rows.map((tx) => [tx.type, tx.currency, tx.amount])).toEqual([
      ["SETTLEMENT", "USD", 50_00n],
      ["SETTLEMENT", "USD", 50_00n],
    ]);
  });

  it("keeps a COP settlement in COP, unchanged (single currency)", async () => {
    const { deps, store } = householdLedger();
    const settlement = unwrap(
      await createRecordSettlement(deps)(
        pedroPaysAna({ amount: cop(120_000_00n), destinationAccountId: ACCOUNTS.bancolombia.id }),
      ),
    );
    expect(settlement).toMatchObject({ amount: 120_000_00n, currency: "COP" });
    expect("destinationAmount" in settlement).toBe(false);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(120_000_00n);
  });
});

describe("RecordPairSettlement in the debt's own currency (P342, P334)", () => {
  const pair = () => householdLedger([memberOf("Ana", "OWNER", 0), memberOf("Juan", "ADMIN", 1)]);

  it("records a transfer from Juan of 50 USD that reached Ana's COP account as 205.000 COP", async () => {
    const { deps, store } = pair();
    const record = createRecordPairSettlement(deps, createRecordSettlement(deps));
    const settlement = unwrap(
      await record({
        spaceId: "space-household",
        userId: "u-ana",
        date: "2026-11-18" as LocalDate,
        amount: usd(50_00n),
        direction: "FROM",
        accountId: ACCOUNTS.bancolombia.id,
        accountAmount: cop(205_000_00n),
      }),
    );
    expect(settlement).toMatchObject({
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      currency: "USD",
      destinationAmount: 205_000_00n,
      destinationCurrency: "COP",
    });
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(205_000_00n);
  });

  it("puts the account amount on the source when Ana gives the money", async () => {
    const { deps } = pair();
    const record = createRecordPairSettlement(deps, createRecordSettlement(deps));
    const settlement = unwrap(
      await record({
        spaceId: "space-household",
        userId: "u-ana",
        date: "2026-11-18" as LocalDate,
        amount: usd(50_00n),
        direction: "TO",
        accountId: ACCOUNTS.bancolombia.id,
        accountAmount: cop(205_000_00n),
      }),
    );
    expect(settlement).toMatchObject({ currency: "USD", sourceAmount: 205_000_00n, sourceCurrency: "COP" });
  });
});
