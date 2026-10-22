import { describe, expect, it } from "vitest";
import {
  prefillOf,
  settlementFieldOf,
  settlementRequestOf,
  type SettlementDraft,
} from "./settlement-request";

const WHEN = { date: "2026-10-31", occurredAt: "2026-10-31T17:00:00.000Z", timeZone: "America/Bogota" };
const input = { currency: "COP", numberFormat: "DOT_COMMA" as const, meMemberId: "m-juan", when: WHEN };
const draft = (overrides: Partial<SettlementDraft> = {}): SettlementDraft => ({
  payerMemberId: "m-juan",
  receivingMemberId: "m-ana",
  amount: "100.000",
  sourceAccountId: null,
  destinationAccountId: null,
  ...overrides,
});

describe("settlement request (HU-E9-07, ruling P174)", () => {
  it("records a payment now from the payer to the receiver", () => {
    expect(settlementRequestOf(draft(), input)).toEqual({
      ok: true,
      body: {
        ...WHEN,
        amount: { amount: "10000000", currency: "COP" },
        payerMemberId: "m-juan",
        receivingMemberId: "m-ana",
      },
    });
  });

  it("names the viewer's own accounts only on the viewer's side, and none for anyone else", () => {
    const mine = settlementRequestOf(
      draft({ sourceAccountId: "a-davi", destinationAccountId: "a-x" }),
      input,
    );
    expect(mine.ok && mine.body).toMatchObject({ sourceAccountId: "a-davi" });
    expect(mine.ok && mine.body).not.toHaveProperty("destinationAccountId");
    const guest = settlementRequestOf(
      draft({
        payerMemberId: "m-pedro",
        receivingMemberId: "m-juan",
        sourceAccountId: "a-davi",
        destinationAccountId: "a-davi",
      }),
      input,
    );
    expect(guest.ok && guest.body).not.toHaveProperty("sourceAccountId");
    expect(guest.ok && guest.body).toMatchObject({ destinationAccountId: "a-davi" });
  });

  it("refuses what it cannot send and maps the API's codes to their fields", () => {
    expect(settlementRequestOf(draft({ payerMemberId: null }), input)).toEqual({ ok: false, field: "payer" });
    expect(settlementRequestOf(draft({ receivingMemberId: "m-juan" }), input)).toEqual({
      ok: false,
      field: "receiver",
    });
    expect(settlementRequestOf(draft({ amount: "cien" }), input)).toEqual({ ok: false, field: "amount" });
    const p = (code: string, path?: string) => ({
      code,
      status: 422,
      requestId: "r",
      errors: path ? [{ path, message: "x" }] : [],
      field: null,
    });
    expect(settlementFieldOf(p("InvalidAmount"))).toBe("amount");
    expect(settlementFieldOf(p("InvalidSettlementParties"))).toBe("receiver");
    expect(settlementFieldOf(p("GuestHasNoAccounts"))).toBe("payer");
    expect(settlementFieldOf(p("ValidationFailed", "receivingMemberId"))).toBe("receiver");
    expect(settlementFieldOf(p("IdempotencyKeyConflict"))).toBe("form");
  });

  it("prefills a suggestion's payer, receiver and amount in the person's format", () => {
    const suggestion = {
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
      amount: { amount: "10000000", currency: "COP" },
    };
    expect(
      prefillOf({ suggestion, meMemberId: "m-juan", currency: "COP", numberFormat: "DOT_COMMA" }),
    ).toEqual(draft());
    expect(
      prefillOf({ suggestion: null, meMemberId: "m-ana", currency: "COP", numberFormat: "DOT_COMMA" }),
    ).toEqual(draft({ payerMemberId: null, receivingMemberId: "m-ana", amount: "" }));
    expect(
      prefillOf({
        suggestion: null,
        payerMemberId: "m-pedro",
        meMemberId: "m-ana",
        currency: "COP",
        numberFormat: "DOT_COMMA",
      }),
    ).toMatchObject({ payerMemberId: "m-pedro", receivingMemberId: "m-ana" });
  });
});
