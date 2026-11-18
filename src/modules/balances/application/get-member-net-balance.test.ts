import { describe, expect, it } from "vitest";
import { anExpense, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { createGetMemberNetBalance, createGetMemberNetBalances } from "./get-member-net-balance";

describe("GetMemberNetBalance (HU-E5-01, for HU-E1-08, HU-E1-09, HU-E1-12)", () => {
  it("returns one member's net in one space, and none for a member or a space nothing moved", async () => {
    const ledger = new InMemoryTransactions();
    // Ana pays 300,000 COP in Household, split equally with Juan: 150,000 COP each.
    await ledger.add(
      anExpense("2026-10-05", 30_000_000n, {
        spaceId: "space-household",
        payments: [{ memberId: "member-ana", accountId: null, amount: 30_000_000n }],
        shares: [
          { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
          { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    const netBalance = createGetMemberNetBalance(ledger);
    expect(await netBalance("space-household", "member-juan", "COP")).toEqual([
      { currency: "COP", net: -15_000_000n },
    ]);
    expect(await netBalance("space-household", "member-ana", "COP")).toEqual([
      { currency: "COP", net: 15_000_000n },
    ]);
    expect(await netBalance("space-household", "member-luis", "COP")).toEqual([]);
    expect(await netBalance("space-trip", "member-juan", "COP")).toEqual([]);
  });

  it("returns a member's non-zero net in every currency, the space's first, never converted (P342)", async () => {
    const ledger = new InMemoryTransactions();
    // Juan owes Ana 30 USD and 60 EUR; in COP they are even.
    const paidBy = (payer: string, ower: string, amount: bigint, currency: string) =>
      ledger.add({
        ...anExpense("2026-10-05", amount, {
          spaceId: "space-household",
          payments: [{ memberId: payer, accountId: null, amount }],
          shares: [{ memberId: ower, amount, splitMethod: "EXACT" }],
        }),
        currency,
      });
    await paidBy("member-ana", "member-juan", 6_000n, "EUR");
    await paidBy("member-ana", "member-juan", 3_000n, "USD");
    await paidBy("member-ana", "member-juan", 10_000_000n, "COP");
    await paidBy("member-juan", "member-ana", 10_000_000n, "COP");
    const netBalance = createGetMemberNetBalance(ledger);
    expect(await netBalance("space-household", "member-juan", "COP")).toEqual([
      { currency: "EUR", net: -6_000n },
      { currency: "USD", net: -3_000n },
    ]);
    expect(await netBalance("space-household", "member-ana", "USD")).toEqual([
      { currency: "USD", net: 3_000n },
      { currency: "EUR", net: 6_000n },
    ]);
    // Without the space currency, by ISO code alone.
    expect(await netBalance("space-household", "member-ana")).toEqual([
      { currency: "EUR", net: 6_000n },
      { currency: "USD", net: 3_000n },
    ]);
  });
});

describe("GetMemberNetBalances (HU-E5-01, for HU-E1-09)", () => {
  it("returns the nets of the given members in their order, per currency, from one aggregate (P342)", async () => {
    const ledger = new InMemoryTransactions();
    // Ana pays 300,000 COP in Household, split equally with Juan: 150,000 COP each.
    await ledger.add(
      anExpense("2026-10-05", 30_000_000n, {
        spaceId: "space-household",
        payments: [{ memberId: "member-ana", accountId: null, amount: 30_000_000n }],
        shares: [
          { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
          { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
        ],
      }),
    );
    let reads = 0;
    const netBalances = createGetMemberNetBalances({
      memberTotals: async (spaceId) => {
        reads += 1;
        return ledger.memberTotals(spaceId);
      },
    });
    await ledger.add({
      ...anExpense("2026-10-06", 5_000n, {
        spaceId: "space-household",
        payments: [{ memberId: "member-juan", accountId: null, amount: 5_000n }],
        shares: [{ memberId: "member-ana", amount: 5_000n, splitMethod: "EXACT" }],
      }),
      currency: "USD",
    });
    expect(await netBalances("space-household", ["member-juan", "member-luis", "member-ana"], "COP")).toEqual(
      [
        [
          { currency: "COP", net: -15_000_000n },
          { currency: "USD", net: 5_000n },
        ],
        [],
        [
          { currency: "COP", net: 15_000_000n },
          { currency: "USD", net: -5_000n },
        ],
      ],
    );
    expect(reads).toBe(1);
  });
});
