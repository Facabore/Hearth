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
