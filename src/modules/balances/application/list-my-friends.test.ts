import { describe, expect, it } from "vitest";
import { createSpaceAccess, type SpaceId, type SpaceMemberId } from "@/modules/spaces/application";
import { unwrap } from "../../../../tests/support/fakes";
import { anExpense, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createListMyFriends, friendOrder, type Friend } from "./list-my-friends";

const friend = (spaceId: string, name: string, date: string | null): Friend => ({
  spaceId,
  currency: "COP",
  me: { memberId: "member-ana" },
  other: { memberId: `member-${spaceId}` as SpaceMemberId, kind: "USER", displayName: name, nickname: null },
  name,
  net: 0n,
  nets: [],
  lastMovement:
    date === null ? null : { transactionId: `t-${spaceId}`, date, description: "Cena", type: "EXPENSE" },
});

describe("the order of Amigos (P338)", () => {
  it("puts the newest last movement first, then names ignoring case, and people with nothing left last", () => {
    const friends = [
      friend("s1", "luis", "2026-10-01"),
      friend("s2", "Sofi", null),
      friend("s3", "Juan", "2026-10-14"),
      friend("s4", "Ana", null),
      friend("s5", "Marta", "2026-10-01"),
    ];
    expect([...friends].sort(friendOrder).map((f) => f.name)).toEqual([
      "Juan",
      "luis",
      "Marta",
      "Ana",
      "Sofi",
    ]);
  });

  it("orders two people with the same name and date by space, so the list never reshuffles", () => {
    const friends = [friend("s2", "Juan", "2026-10-14"), friend("s1", "Juan", "2026-10-14")];
    expect([...friends].sort(friendOrder).map((f) => f.spaceId)).toEqual(["s1", "s2"]);
  });
});

describe("ListMyFriends (P338)", () => {
  it("gives the viewer's nets with a friend in every currency apart, the space's first; `net` stays its currency's (P342)", async () => {
    const spaces = new InMemorySpaceStore();
    // Ana and Juan's direct space, in COP.
    spaces.seed({
      ...householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Juan", "OWNER", 1)]),
      id: "space-household" as SpaceId,
      kind: "DIRECT",
    });
    const ledger = new InMemoryTransactions();
    const paidFor = (payer: string, debtor: string, amount: bigint, currency: string) =>
      ledger.add({
        ...anExpense("2026-10-05", amount, {
          spaceId: "space-household",
          payments: [{ memberId: payer, accountId: null, amount }],
          shares: [{ memberId: debtor, amount, splitMethod: "EXACT" as const }],
        }),
        currency,
      });
    // Juan owes Ana 500.000 COP and 60 EUR; Ana owes Juan 50 USD.
    await paidFor("member-ana", "member-juan", 50_000_000n, "COP");
    await paidFor("member-juan", "member-ana", 5_000n, "USD");
    await paidFor("member-ana", "member-juan", 6_000n, "EUR");
    const list = createListMyFriends({
      access: createSpaceAccess(spaces),
      members: spaces,
      source: ledger,
      spaces,
      aliases: { peerAliasesOf: async () => [] },
      movements: { lastMovementsIn: async () => [] },
    });
    const [juan] = unwrap(await list("u-ana"));
    expect(juan?.net).toBe(50_000_000n);
    expect(juan?.nets).toEqual([
      { currency: "COP", net: 50_000_000n },
      { currency: "EUR", net: 6_000n },
      { currency: "USD", net: -5_000n },
    ]);
  });
});
