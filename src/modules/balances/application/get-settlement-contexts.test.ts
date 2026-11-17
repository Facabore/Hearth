import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import type { DatedDebtMovements } from "../domain/balances";
import { createGetSettlementContexts } from "./get-settlement-contexts";

const place = (transactionId: string, date: string) => ({
  transactionId,
  date: date as LocalDate,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
});

/** Juan paid 100 for both in each space: Ana owes him 50 there. */
const owed = (prefix: string): DatedDebtMovements => ({
  expenses: [
    {
      ...place(`${prefix}-dinner`, "2026-10-01"),
      payments: [{ memberId: "juan", amount: 100n }],
      shares: [
        { memberId: "ana", amount: 50n },
        { memberId: "juan", amount: 50n },
      ],
    },
  ],
  settlements: [
    {
      ...place(`${prefix}-pay`, "2026-10-02"),
      payerMemberId: "ana",
      receivingMemberId: "juan",
      amount: 80n,
      reason: "PAYMENT",
      onBehalfOfMemberId: null,
    },
  ],
});

describe("GetSettlementContexts (ruling P339, S9)", () => {
  it("reads each space asked about once, never a space with nothing to describe, and answers by payment", async () => {
    const reads: string[] = [];
    const get = createGetSettlementContexts({
      debtMovements: async (spaceId) => {
        reads.push(spaceId);
        return owed(spaceId);
      },
    });
    const found = await get([
      { spaceId: "direct", currency: "COP", settlementIds: ["direct-pay"] },
      { spaceId: "home", currency: "COP", settlementIds: ["home-pay"] },
      { spaceId: "trip", currency: "COP", settlementIds: [] },
    ]);
    expect(reads.sort()).toEqual(["direct", "home"]);
    expect(Object.fromEntries(found)).toEqual({
      "direct-pay": { kind: "PAID_AND_LENT", paid: 50n, lent: 30n },
      "home-pay": { kind: "PAID_AND_LENT", paid: 50n, lent: 30n },
    });
  });

  it("leaves out a space whose currency Money does not know, and still answers the others", async () => {
    const get = createGetSettlementContexts({ debtMovements: async (spaceId) => owed(spaceId) });
    const found = await get([
      { spaceId: "odd", currency: "XXX", settlementIds: ["odd-pay"] },
      { spaceId: "home", currency: "COP", settlementIds: ["home-pay"] },
    ]);
    expect([...found.keys()]).toEqual(["home-pay"]);
  });
});
