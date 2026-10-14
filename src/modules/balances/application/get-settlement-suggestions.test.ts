import { describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { anExpense, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createGetSettlementSuggestions } from "./get-settlement-suggestions";

const pesos = (n: bigint) => n * 100n;
// HU-E5-03 Background: "Trip 2026" with Ana, Juan and Luis (the Household fixture of the in-memory store).
const world = (
  members = [memberOf("Ana", "OWNER", 0), memberOf("Juan", "MEMBER", 1), memberOf("Luis", "MEMBER", 2)],
) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(members));
  const ledger = new InMemoryTransactions();
  const suggest = createGetSettlementSuggestions({
    access: createSpaceAccess(spaces),
    members: spaces,
    source: ledger,
  });
  return { spaces, ledger, suggest };
};

/** An expense of Household paid in full by `payer` and shared in exact amounts. */
const paidFor = (payer: string, amount: bigint, shares: readonly (readonly [string, bigint])[]) =>
  anExpense("2026-10-05", amount, {
    spaceId: "space-household",
    payments: [{ memberId: payer, accountId: null, amount }],
    shares: shares.map(([memberId, share]) => ({ memberId, amount: share, splitMethod: "EXACT" as const })),
  });

describe("GetSettlementSuggestions (HU-E5-03)", () => {
  it("turns Ana +150,000, Juan −100,000 and Luis −50,000 COP into two payments to Ana, in the space currency", async () => {
    const { ledger, suggest } = world();
    // Ana pays 150,000 COP for Juan (100,000) and Luis (50,000).
    await ledger.add(
      anExpense("2026-10-05", pesos(150_000n), {
        spaceId: "space-household",
        payments: [{ memberId: "member-ana", accountId: null, amount: pesos(150_000n) }],
        shares: [
          { memberId: "member-juan", amount: pesos(100_000n), splitMethod: "EXACT" },
          { memberId: "member-luis", amount: pesos(50_000n), splitMethod: "EXACT" },
        ],
      }),
    );
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-luis" }))).toEqual({
      spaceId: "space-household",
      currency: "COP",
      suggestions: [
        { payerMemberId: "member-juan", receivingMemberId: "member-ana", amount: pesos(100_000n) },
        { payerMemberId: "member-luis", receivingMemberId: "member-ana", amount: pesos(50_000n) },
      ],
    });
  });

  it("suggests nothing when every member is settled", async () => {
    const { suggest } = world();
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-ana" })).suggestions).toEqual([]);
  });

  it("leaves a member whose net is zero out of every suggestion", async () => {
    const { ledger, suggest } = world();
    // Ana pays 100,000 for Juan and Juan pays 100,000 for Luis, so Juan nets 0 and Luis owes Ana.
    await ledger.add(paidFor("member-ana", pesos(100_000n), [["member-juan", pesos(100_000n)]]));
    await ledger.add(paidFor("member-juan", pesos(100_000n), [["member-luis", pesos(100_000n)]]));
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-ana" })).suggestions).toEqual([
      { payerMemberId: "member-luis", receivingMemberId: "member-ana", amount: pesos(100_000n) },
    ]);
  });

  it("includes a guest with a balance and a former member the totals still mention", async () => {
    const { ledger, suggest } = world([memberOf("Ana", "OWNER", 0), memberOf("Pedro", null, 1)]);
    // Pedro (guest) owes Ana 60,000; Zed left the space but still owes Ana 40,000.
    await ledger.add(
      paidFor("member-ana", pesos(100_000n), [
        ["member-pedro", pesos(60_000n)],
        ["member-zed", pesos(40_000n)],
      ]),
    );
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-ana" })).suggestions).toEqual([
      { payerMemberId: "member-pedro", receivingMemberId: "member-ana", amount: pesos(60_000n) },
      { payerMemberId: "member-zed", receivingMemberId: "member-ana", amount: pesos(40_000n) },
    ]);
  });

  it("lets every member read, viewers included, and hides the space from non-members", async () => {
    const { suggest } = world([memberOf("Ana", "OWNER", 0), memberOf("Sofi", "VIEWER", 1)]);
    expect(codeOf(await suggest({ spaceId: "space-household", userId: "u-sofi" }))).toBe("ok");
    expect(codeOf(await suggest({ spaceId: "space-household", userId: "u-marta" }))).toBe("SpaceNotFound");
  });

  it("hides an unknown space from everyone", async () => {
    const { suggest } = world();
    expect(codeOf(await suggest({ spaceId: "space-nowhere", userId: "u-ana" }))).toBe("SpaceNotFound");
  });

  it("still answers for an archived space, which only reads (HU-E1-09)", async () => {
    const { spaces, ledger, suggest } = world();
    await ledger.add(paidFor("member-ana", pesos(150_000n), [["member-juan", pesos(150_000n)]]));
    spaces.archived.add("space-household");
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-juan" })).suggestions).toEqual([
      { payerMemberId: "member-juan", receivingMemberId: "member-ana", amount: pesos(150_000n) },
    ]);
    expect(codeOf(await suggest({ spaceId: "space-household", userId: "u-marta" }))).toBe("SpaceNotFound");
  });
});
