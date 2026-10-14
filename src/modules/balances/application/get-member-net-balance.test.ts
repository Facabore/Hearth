import { describe, expect, it } from "vitest";
import { anExpense, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { createGetMemberNetBalance } from "./get-member-net-balance";

describe("GetMemberNetBalance (HU-E5-01, for HU-E1-08, HU-E1-09, HU-E1-12)", () => {
  it("returns one member's net in one space, and 0 for a member or a space nothing moved", async () => {
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
    expect(await netBalance("space-household", "member-juan")).toBe(-15_000_000n);
    expect(await netBalance("space-household", "member-ana")).toBe(15_000_000n);
    expect(await netBalance("space-household", "member-luis")).toBe(0n);
    expect(await netBalance("space-trip", "member-juan")).toBe(0n);
  });
});
