import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { createGetSettlementContexts, type CurrencyDatedDebtMovements } from "./get-settlement-contexts";

const place = (transactionId: string, date: string) => ({
  transactionId,
  date: date as LocalDate,
  createdAt: new Date("2026-11-01T12:00:00.000Z"),
});

/** Juan paid 100 for both in each space: Ana owes him 50 there; then she pays him 80, all in `currency`. */
const owed = (prefix: string, currency = "COP"): CurrencyDatedDebtMovements => ({
  expenses: [
    {
      ...place(`${prefix}-dinner`, "2026-10-01"),
      currency,
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
      currency,
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

  it("leaves out a payment in a currency Money does not know, and still answers the others", async () => {
    const get = createGetSettlementContexts({
      debtMovements: async (spaceId) => owed(spaceId, spaceId === "odd" ? "XXX" : "COP"),
    });
    const found = await get([
      { spaceId: "odd", settlementIds: ["odd-pay"] },
      { spaceId: "home", settlementIds: ["home-pay"] },
    ]);
    expect([...found.keys()]).toEqual(["home-pay"]);
  });

  it("replays each payment against the debts of its own currency alone (P342, S4)", async () => {
    // Ana owes Juan 50 COP; she pays him 80 USD, then 30 COP.
    const movements = owed("mixed");
    const get = createGetSettlementContexts({
      debtMovements: async () => ({
        expenses: movements.expenses,
        settlements: [
          { ...movements.settlements[0]!, currency: "USD" },
          {
            ...movements.settlements[0]!,
            ...place("mixed-pay-cop", "2026-10-03"),
            amount: 30n,
          },
        ],
      }),
    });
    const found = await get([
      // The space's currency the ledger still sends is no longer what a payment is replayed in.
      { spaceId: "mixed", currency: "COP", settlementIds: ["mixed-pay", "mixed-pay-cop"] },
    ]);
    expect(Object.fromEntries(found)).toEqual({
      "mixed-pay": { kind: "LENT", paid: 0n, lent: 80n },
      "mixed-pay-cop": { kind: "PAID", paid: 30n, lent: 0n },
    });
  });
});
