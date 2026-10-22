import { describe, expect, it } from "vitest";
import { sharedPartsOf, splitCheckOf, type SplitDraft } from "./split-request";

const MEMBERS = ["m-ana", "m-juan", "m-pedro"];
const draft = (overrides: Partial<SplitDraft> = {}): SplitDraft => ({
  payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
  method: "EQUAL",
  selected: ["m-juan", "m-ana"],
  values: {},
  chosen: false,
  ...overrides,
});
const input = { amount: "30000000", currency: "COP", numberFormat: "DOT_COMMA" as const, memberIds: MEMBERS };
const cop = (amount: string) => ({ amount, currency: "COP" });

describe("sharedPartsOf (HU-E9-06, rulings P168 and P169)", () => {
  it("pays from the recorder's account and splits equally among the chosen members, in join order", () => {
    expect(sharedPartsOf(draft(), input)).toEqual({
      ok: true,
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop("30000000") }],
      split: { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] },
    });
  });

  it("sends percents, amounts and units as typed, never the previewed shares", () => {
    const values = { "m-ana": "40", "m-juan": "60" };
    expect(
      sharedPartsOf(draft({ method: "PERCENT", values }), input).ok &&
        sharedPartsOf(draft({ method: "PERCENT", values }), input),
    ).toMatchObject({
      split: {
        method: "PERCENT",
        participants: [
          { memberId: "m-ana", percent: "40" },
          { memberId: "m-juan", percent: "60" },
        ],
      },
    });
    const exact = sharedPartsOf(
      draft({ method: "EXACT", values: { "m-ana": "100.000", "m-juan": "200.000" } }),
      input,
    );
    expect(exact).toMatchObject({
      split: {
        method: "EXACT",
        participants: [
          { memberId: "m-ana", amount: cop("10000000") },
          { memberId: "m-juan", amount: cop("20000000") },
        ],
      },
    });
    const shares = sharedPartsOf(draft({ method: "SHARES", values: { "m-ana": "2", "m-juan": "1" } }), input);
    expect(shares).toMatchObject({
      split: {
        method: "SHARES",
        participants: [
          { memberId: "m-ana", units: 2 },
          { memberId: "m-juan", units: 1 },
        ],
      },
    });
  });

  it("sends a percent in the API's decimal notation whatever the person's number format", () => {
    const values = { "m-ana": "37,5", "m-juan": "62,5" };
    expect(sharedPartsOf(draft({ method: "PERCENT", values }), input)).toMatchObject({
      split: {
        method: "PERCENT",
        participants: [
          { memberId: "m-ana", percent: "37.5" },
          { memberId: "m-juan", percent: "62.5" },
        ],
      },
    });
  });

  it("leaves the split to the server for BY_ALLOCATION, and pays for a guest or from the fund", () => {
    expect(sharedPartsOf(draft({ method: "BY_ALLOCATION" }), input)).toMatchObject({ ok: true, split: null });
    expect(sharedPartsOf(draft({ payer: { kind: "GUEST", memberId: "m-pedro" } }), input)).toMatchObject({
      payments: [{ memberId: "m-pedro", accountId: null, amount: cop("30000000") }],
    });
    expect(sharedPartsOf(draft({ payer: { kind: "FUND", accountId: "a-fund" } }), input)).toMatchObject({
      payments: [{ memberId: null, accountId: "a-fund", amount: cop("30000000") }],
    });
  });

  it("refuses a recorder without an account and an invalid split", () => {
    expect(
      sharedPartsOf(draft({ payer: { kind: "ME", memberId: "m-ana", accountId: null } }), input),
    ).toEqual({ ok: false, field: "payer" });
    expect(
      sharedPartsOf(draft({ method: "PERCENT", values: { "m-ana": "40", "m-juan": "50" } }), input),
    ).toEqual({ ok: false, field: "split" });
    expect(sharedPartsOf(draft({ selected: [] }), input)).toEqual({ ok: false, field: "split" });
  });
});

describe("splitCheckOf", () => {
  it("waits for an amount, and for the API's shares when the split follows the plan", () => {
    expect(splitCheckOf(draft(), { ...input, amount: null, allocation: null })).toBeNull();
    expect(splitCheckOf(draft({ method: "BY_ALLOCATION" }), { ...input, allocation: null })).toBeNull();
    expect(
      splitCheckOf(draft({ method: "BY_ALLOCATION" }), {
        ...input,
        allocation: [
          { memberId: "m-ana", amount: "12000000" },
          { memberId: "m-juan", amount: "18000000" },
        ],
      }),
    ).toEqual({
      ok: true,
      shares: [
        { memberId: "m-ana", amount: "12000000" },
        { memberId: "m-juan", amount: "18000000" },
      ],
    });
  });
});
