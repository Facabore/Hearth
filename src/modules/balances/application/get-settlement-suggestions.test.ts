import { describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { anExpense, aSettlement, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
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

  it("has each member pay whoever paid for them, even a member whose net is zero (P323)", async () => {
    const { ledger, suggest } = world();
    // Ana pays 100,000 for Juan and Juan pays 100,000 for Luis: Juan nets 0, but Luis owes Juan, not Ana.
    await ledger.add(paidFor("member-ana", pesos(100_000n), [["member-juan", pesos(100_000n)]]));
    await ledger.add(paidFor("member-juan", pesos(100_000n), [["member-luis", pesos(100_000n)]]));
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-ana" })).suggestions).toEqual([
      { payerMemberId: "member-juan", receivingMemberId: "member-ana", amount: pesos(100_000n) },
      { payerMemberId: "member-luis", receivingMemberId: "member-juan", amount: pesos(100_000n) },
    ]);
  });

  it("nets each pair over its expenses and settlements, as on staging (P323, S5)", async () => {
    const { ledger, suggest } = world();
    // Ana paid 50,000 with Juan; Juan paid 16,000 and 15,000 split in three; Luis paid Juan 3,000 back.
    await ledger.add(
      paidFor("member-ana", pesos(50_000n), [
        ["member-ana", pesos(25_000n)],
        ["member-juan", pesos(25_000n)],
      ]),
    );
    await ledger.add(
      paidFor("member-juan", pesos(16_000n), [
        ["member-ana", pesos(5_334n)],
        ["member-juan", pesos(5_333n)],
        ["member-luis", pesos(5_333n)],
      ]),
    );
    await ledger.add(
      paidFor("member-juan", pesos(15_000n), [
        ["member-ana", pesos(5_000n)],
        ["member-juan", pesos(5_000n)],
        ["member-luis", pesos(5_000n)],
      ]),
    );
    await ledger.add(
      aSettlement("2026-10-06", pesos(3_000n), {
        payerMemberId: "member-luis",
        receivingMemberId: "member-juan",
      }),
    );
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-luis" })).suggestions).toEqual([
      { payerMemberId: "member-juan", receivingMemberId: "member-ana", amount: pesos(14_666n) },
      { payerMemberId: "member-luis", receivingMemberId: "member-juan", amount: pesos(7_333n) },
    ]);
  });

  it("leaves out deleted expenses, fund-paid expenses and other spaces' movements", async () => {
    const { ledger, suggest } = world();
    await ledger.add({
      ...paidFor("member-ana", pesos(80_000n), [["member-juan", pesos(80_000n)]]),
      deletedAt: new Date("2026-10-06T00:00:00Z"),
    });
    await ledger.add(
      anExpense("2026-10-05", pesos(90_000n), {
        spaceId: "space-household",
        payments: [{ memberId: null, accountId: "account-fund", amount: pesos(90_000n) }],
        shares: [{ memberId: "member-juan", amount: pesos(90_000n), splitMethod: "EXACT" }],
      }),
    );
    await ledger.add({
      ...paidFor("member-ana", pesos(70_000n), [["member-luis", pesos(70_000n)]]),
      spaceId: "space-other",
    });
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-ana" })).suggestions).toEqual([]);
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

  it("has a debt to a former member paid to whom that member owed, as nobody can settle with them (P323)", async () => {
    const { ledger, suggest } = world();
    // Zed, who left, paid 40,000 for Juan; Luis paid 30,000 for Zed. Juan pays Luis, and only the rest stays Zed's.
    await ledger.add(paidFor("member-zed", pesos(40_000n), [["member-juan", pesos(40_000n)]]));
    await ledger.add(paidFor("member-luis", pesos(30_000n), [["member-zed", pesos(30_000n)]]));
    expect(unwrap(await suggest({ spaceId: "space-household", userId: "u-ana" })).suggestions).toEqual([
      { payerMemberId: "member-juan", receivingMemberId: "member-luis", amount: pesos(30_000n) },
      { payerMemberId: "member-juan", receivingMemberId: "member-zed", amount: pesos(10_000n) },
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
