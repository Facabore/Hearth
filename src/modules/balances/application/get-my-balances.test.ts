import { describe, expect, it } from "vitest";
import { createPersonalSpace, type SpaceId, type SpaceMemberId } from "@/modules/spaces/domain/space";
import { createSpaceAccess } from "@/modules/spaces/application";
import { unwrap } from "../../../../tests/support/fakes";
import { anExpense, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createGetMyBalances } from "./get-my-balances";

const pesos = (n: bigint) => n * 100n;
const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const LUIS = memberOf("Luis", "MEMBER", 2);

/** Household (Ana, Juan, Luis) and Ana's personal space. */
const world = () => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace([ANA, JUAN, LUIS]));
  spaces.seed(
    createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now: new Date("2026-10-01T12:00:00Z"),
    }),
  );
  const ledger = new InMemoryTransactions();
  const getMyBalances = createGetMyBalances({
    access: createSpaceAccess(spaces),
    members: spaces,
    spaces,
    source: ledger,
  });
  return { ledger, getMyBalances };
};

/** Juan pays 150,000 COP for Ana (100,000) and Luis (50,000). */
const juanPaysForAnaAndLuis = () =>
  anExpense("2026-10-05", pesos(150_000n), {
    spaceId: "space-household",
    payments: [{ memberId: "member-juan", accountId: null, amount: pesos(150_000n) }],
    shares: [
      { memberId: "member-ana", amount: pesos(100_000n), splitMethod: "EXACT" as const },
      { memberId: "member-luis", amount: pesos(50_000n), splitMethod: "EXACT" as const },
    ],
  });

describe("GetMyBalances (#240, P278)", () => {
  it("gives the viewer's net in each space with balances, her payments and the members by name; never the personal space", async () => {
    const { ledger, getMyBalances } = world();
    await ledger.add(juanPaysForAnaAndLuis());
    expect(unwrap(await getMyBalances("u-ana"))).toEqual([
      {
        spaceId: "space-household",
        currency: "COP",
        memberId: "member-ana",
        net: -pesos(100_000n),
        nets: [{ currency: "COP", net: -pesos(100_000n) }],
        members: [
          { memberId: "member-ana", name: "Ana" },
          { memberId: "member-juan", name: "Juan" },
          { memberId: "member-luis", name: "Luis" },
        ],
        payments: [{ receivingMemberId: "member-juan", amount: pesos(100_000n), currency: "COP" }],
      },
    ]);
  });

  it("gives a member who is owed her net and no payments of her own", async () => {
    const { ledger, getMyBalances } = world();
    await ledger.add(juanPaysForAnaAndLuis());
    const [household] = unwrap(await getMyBalances("u-juan"));
    expect(household?.net).toBe(pesos(150_000n));
    expect(household?.payments).toEqual([]);
  });

  it("has her pay whoever paid for her, each pair on its own, the largest first (P323)", async () => {
    const { ledger, getMyBalances } = world();
    const paidFor = (payer: string, debtor: string, amount: bigint) =>
      anExpense("2026-10-05", amount, {
        spaceId: "space-household",
        payments: [{ memberId: payer, accountId: null, amount }],
        shares: [{ memberId: debtor, amount, splitMethod: "EXACT" as const }],
      });
    // Ana pays 100,000 for Juan, Juan pays 100,000 for Luis and Ana pays 30,000 for Luis.
    await ledger.add(paidFor("member-ana", "member-juan", pesos(100_000n)));
    await ledger.add(paidFor("member-juan", "member-luis", pesos(100_000n)));
    await ledger.add(paidFor("member-ana", "member-luis", pesos(30_000n)));
    const [household] = unwrap(await getMyBalances("u-luis"));
    expect(household?.net).toBe(-pesos(130_000n));
    expect(household?.payments).toEqual([
      { receivingMemberId: "member-juan", amount: pesos(100_000n), currency: "COP" },
      { receivingMemberId: "member-ana", amount: pesos(30_000n), currency: "COP" },
    ]);
  });

  it("has her pay whom a former member owed, as nobody can pay them (P323)", async () => {
    const { ledger, getMyBalances } = world();
    const paidFor = (payer: string, debtor: string, amount: bigint) =>
      anExpense("2026-10-05", amount, {
        spaceId: "space-household",
        payments: [{ memberId: payer, accountId: null, amount }],
        shares: [{ memberId: debtor, amount, splitMethod: "EXACT" as const }],
      });
    // Zed, who left, paid 40,000 for Luis; Juan paid 30,000 for Zed.
    await ledger.add(paidFor("member-zed", "member-luis", pesos(40_000n)));
    await ledger.add(paidFor("member-juan", "member-zed", pesos(30_000n)));
    const [household] = unwrap(await getMyBalances("u-luis"));
    expect(household?.payments).toEqual([
      { receivingMemberId: "member-juan", amount: pesos(30_000n), currency: "COP" },
      { receivingMemberId: "member-zed", amount: pesos(10_000n), currency: "COP" },
    ]);
  });

  it("answers 0 and no payments in a space where nothing moved", async () => {
    const { getMyBalances } = world();
    const [household] = unwrap(await getMyBalances("u-ana"));
    expect(household?.net).toBe(0n);
    expect(household?.nets).toEqual([]);
    expect(household?.payments).toEqual([]);
  });

  it("gives her nets and payments in every currency apart, the space's first; `net` stays the space currency's (P342)", async () => {
    const { ledger, getMyBalances } = world();
    const paidFor = (payer: string, debtor: string, amount: bigint, currency: string) => ({
      ...anExpense("2026-10-05", amount, {
        spaceId: "space-household",
        payments: [{ memberId: payer, accountId: null, amount }],
        shares: [{ memberId: debtor, amount, splitMethod: "EXACT" as const }],
      }),
      currency,
    });
    // "te puedo deber 500.000 COP, 50 USD y 60 EUR", and Luis owes Ana 20 USD.
    await ledger.add(paidFor("member-juan", "member-ana", pesos(500_000n), "COP"));
    await ledger.add(paidFor("member-juan", "member-ana", 5_000n, "USD"));
    await ledger.add(paidFor("member-juan", "member-ana", 6_000n, "EUR"));
    await ledger.add(paidFor("member-ana", "member-luis", 2_000n, "USD"));
    const [household] = unwrap(await getMyBalances("u-ana"));
    expect(household?.net).toBe(-pesos(500_000n));
    expect(household?.nets).toEqual([
      { currency: "COP", net: -pesos(500_000n) },
      { currency: "EUR", net: -6_000n },
      { currency: "USD", net: -3_000n },
    ]);
    expect(household?.payments).toEqual([
      { receivingMemberId: "member-juan", amount: pesos(500_000n), currency: "COP" },
      { receivingMemberId: "member-juan", amount: 6_000n, currency: "EUR" },
      { receivingMemberId: "member-juan", amount: 5_000n, currency: "USD" },
    ]);
  });

  it("answers an empty list to someone without a shared space", async () => {
    const { getMyBalances } = world();
    expect(unwrap(await getMyBalances("u-nobody"))).toEqual([]);
  });
});
