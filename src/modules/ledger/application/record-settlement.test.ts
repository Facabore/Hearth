import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, householdLedger } from "../../../../tests/support/in-memory-ledger";
import { createRecordSettlement, type RecordSettlementInput } from "./record-settlement";

/** HU-E5-02: Juan records a settlement of 1,200,000 COP paid to Ana on 2026-10-30. */
const settle = (overrides: Partial<RecordSettlementInput> = {}): RecordSettlementInput => ({
  spaceId: "space-household",
  userId: "u-juan",
  date: "2026-10-30" as LocalDate,
  amount: money(120_000_000n),
  payerMemberId: "member-juan",
  receivingMemberId: "member-ana",
  ...overrides,
});

describe("RecordSettlement (HU-E5-02)", () => {
  it("records Juan's settlement to Ana as a SETTLEMENT without a category", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordSettlement(deps)(settle()));
    expect(recorded).toMatchObject({
      type: "SETTLEMENT",
      spaceId: "space-household",
      date: "2026-10-30",
      amount: 120_000_000n,
      categoryId: null,
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      destinationAccountId: null,
      createdBy: "u-juan",
    });
    expect(store.rows.map((tx) => tx.id)).toEqual([recorded.id]);
  });

  it("moves money from Juan's own account into Ana's when Juan records it (D9)", async () => {
    const { deps, store } = householdLedger();
    const withAccounts = settle({
      sourceAccountId: ACCOUNTS.davivienda.id,
      destinationAccountId: ACCOUNTS.bancolombia.id,
    });
    expect(codeOf(await createRecordSettlement(deps)(withAccounts))).toBe("ok");
    expect([store.netOf(ACCOUNTS.davivienda.id), store.netOf(ACCOUNTS.bancolombia.id)]).toEqual([
      -120_000_000n,
      120_000_000n,
    ]);
  });

  it("rejects a member settling with themselves (Review Focus 2)", async () => {
    const { deps, store } = householdLedger();
    expect(codeOf(await createRecordSettlement(deps)(settle({ receivingMemberId: "member-juan" })))).toBe(
      "InvalidSettlementParties",
    );
    expect(store.rows).toEqual([]);
  });

  it("lets a member record a settlement paid by a guest, who has no account", async () => {
    const { deps } = householdLedger();
    const record = createRecordSettlement(deps);
    const byPedro = settle({ userId: "u-ana", payerMemberId: "member-pedro", amount: money(10_000_000n) });
    expect(unwrap(await record(byPedro))).toMatchObject({
      payerMemberId: "member-pedro",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      createdBy: "u-ana",
    });
    expect(codeOf(await record({ ...byPedro, sourceAccountId: ACCOUNTS.bancolombia.id }))).toBe(
      "GuestHasNoAccounts",
    );
  });

  it("accepts only accounts owned by the respective party (Review Focus 3)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordSettlement(deps);
    expect(codeOf(await record(settle({ sourceAccountId: ACCOUNTS.bancolombia.id })))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await record(settle({ destinationAccountId: ACCOUNTS.davivienda.id })))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await record(settle({ destinationAccountId: ACCOUNTS.householdFund.id })))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await record(settle({ sourceAccountId: "not-a-uuid" })))).toBe("AccountNotFound");
    // D9: Ana cannot record a settlement that debits Juan's account (crediting Ana's own is allowed above).
    const fromJuans = settle({ userId: "u-ana", sourceAccountId: ACCOUNTS.davivienda.id });
    expect(codeOf(await record(fromJuans))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
  });

  it("requires current members, a positive amount and a role that records money", async () => {
    const { deps } = householdLedger();
    const record = createRecordSettlement(deps);
    expect(codeOf(await record(settle({ payerMemberId: "member-marta" })))).toBe("NotASpaceMember");
    expect(codeOf(await record(settle({ receivingMemberId: "not-a-uuid" })))).toBe("NotASpaceMember");
    expect(codeOf(await record(settle({ amount: money(0n) })))).toBe("InvalidAmount");
    expect(codeOf(await record(settle({ userId: "u-sofi" })))).toBe("InsufficientRole");
    expect(codeOf(await record(settle({ userId: "u-marta" })))).toBe("SpaceNotFound");
  });
});

/** Ruling P322: Juan pays Ana what Luis owes her; Ana forgives Luis; Juan as ADMIN forgives for the guest Pedro. */
describe("RecordSettlement for someone else and forgiveness (ruling P322)", () => {
  const forLuis = (overrides: Partial<RecordSettlementInput> = {}) =>
    settle({ onBehalfOfMemberId: "member-luis", ...overrides });
  const forgive = (overrides: Partial<RecordSettlementInput> = {}) =>
    settle({
      userId: "u-ana",
      payerMemberId: "member-luis",
      receivingMemberId: "member-ana",
      reason: "FORGIVENESS",
      ...overrides,
    });

  it("records a plain settlement as a PAYMENT for nobody, linked to nothing", async () => {
    const { deps } = householdLedger();
    expect(unwrap(await createRecordSettlement(deps)(settle()))).toMatchObject({
      reason: "PAYMENT",
      onBehalfOfMemberId: null,
      linkedTransactionId: null,
    });
  });

  it("records one PAYMENT on Luis's behalf when Luis owes it back (Me lo debe)", async () => {
    const { deps, store } = householdLedger();
    const recorded = unwrap(await createRecordSettlement(deps)(forLuis()));
    expect(recorded).toMatchObject({
      type: "SETTLEMENT",
      reason: "PAYMENT",
      payerMemberId: "member-juan",
      receivingMemberId: "member-ana",
      onBehalfOfMemberId: "member-luis",
      linkedTransactionId: null,
    });
    expect(store.rows.map((tx) => tx.id)).toEqual([recorded.id]);
  });

  it("records a gift as the payment plus a linked GIFT from Luis to Juan without accounts (Se lo regalo)", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordSettlement(deps);
    const payment = unwrap(await record(forLuis({ gift: true, sourceAccountId: ACCOUNTS.davivienda.id })));
    expect(store.rows).toHaveLength(2);
    const gift = store.rows.find((tx) => tx.id !== payment.id)!;
    expect(payment).toMatchObject({
      reason: "PAYMENT",
      onBehalfOfMemberId: "member-luis",
      linkedTransactionId: gift.id,
    });
    expect(gift).toMatchObject({
      type: "SETTLEMENT",
      reason: "GIFT",
      payerMemberId: "member-luis",
      receivingMemberId: "member-juan",
      sourceAccountId: null,
      destinationAccountId: null,
      onBehalfOfMemberId: null,
      linkedTransactionId: payment.id,
      amount: payment.amount,
      date: payment.date,
      occurredAt: payment.occurredAt,
      timeZone: payment.timeZone,
      createdBy: "u-juan",
    });
  });

  it("refuses an on-behalf member who is not a member, the payer or the receiver, and a gift for nobody", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordSettlement(deps);
    for (const member of ["member-marta", "not-a-uuid", "member-juan", "member-ana"]) {
      expect(codeOf(await record(forLuis({ onBehalfOfMemberId: member })))).toBe("InvalidOnBehalfOf");
    }
    expect(codeOf(await record(settle({ gift: true })))).toBe("GiftRequiresOnBehalfOf");
    expect(store.rows).toEqual([]);
  });

  it("records Ana's forgiveness of Luis's debt as a FORGIVENESS from Luis to Ana without accounts", async () => {
    const { deps } = householdLedger();
    expect(unwrap(await createRecordSettlement(deps)(forgive()))).toMatchObject({
      reason: "FORGIVENESS",
      payerMemberId: "member-luis",
      receivingMemberId: "member-ana",
      sourceAccountId: null,
      destinationAccountId: null,
      onBehalfOfMemberId: null,
      linkedTransactionId: null,
      createdBy: "u-ana",
    });
  });

  it("lets only the receiver forgive, or an OWNER or ADMIN when the receiver is a guest", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordSettlement(deps);
    expect(codeOf(await record(forgive({ userId: "u-luis" })))).toBe("ForgivenessNotAllowed");
    expect(codeOf(await record(forgive({ userId: "u-juan" })))).toBe("ForgivenessNotAllowed");
    const forPedro = { receivingMemberId: "member-pedro" };
    expect(codeOf(await record(forgive({ ...forPedro, userId: "u-luis" })))).toBe("ForgivenessNotAllowed");
    expect(store.rows).toEqual([]);
    expect(codeOf(await record(forgive({ ...forPedro, userId: "u-juan" })))).toBe("ok");
    expect(codeOf(await record(forgive({ ...forPedro, userId: "u-ana" })))).toBe("ok");
    expect(store.rows).toHaveLength(2);
  });

  it("refuses accounts, an on-behalf member and a gift on a forgiveness", async () => {
    const { deps, store } = householdLedger();
    const record = createRecordSettlement(deps);
    expect(codeOf(await record(forgive({ destinationAccountId: ACCOUNTS.bancolombia.id })))).toBe(
      "ForgivenessHasNoAccounts",
    );
    expect(
      codeOf(
        await record(
          forgive({
            userId: "u-juan",
            payerMemberId: "member-juan",
            sourceAccountId: ACCOUNTS.davivienda.id,
          }),
        ),
      ),
    ).toBe("ForgivenessHasNoAccounts");
    expect(codeOf(await record(forgive({ onBehalfOfMemberId: "member-juan" })))).toBe("InvalidOnBehalfOf");
    expect(codeOf(await record(forgive({ gift: true })))).toBe("GiftRequiresOnBehalfOf");
    expect(store.rows).toEqual([]);
  });
});
