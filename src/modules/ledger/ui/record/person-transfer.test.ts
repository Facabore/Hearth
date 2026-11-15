import { describe, expect, it } from "vitest";
import type { Person } from "../direct/counterparts";
import { effectOf, personTransferRequest } from "./person-transfer";
import { debtWith } from "./use-pair-debt";

const juan: Person = {
  memberId: "m-juan-h",
  name: "Juan",
  isGuest: false,
  directSpace: null,
  places: [
    { spaceId: null, name: null, kind: "DIRECT", currency: null, theirMemberId: null, myMemberId: null },
    {
      spaceId: "sp-home",
      name: "Hogar",
      kind: "SHARED",
      currency: "COP",
      theirMemberId: "m-juan-h",
      myMemberId: "m-ana-h",
    },
  ],
};
const base = { date: "2026-11-14", amount: { amount: "15000000", currency: "COP" }, accountId: "a-bank" };

describe("a transfer to or from someone (P334)", () => {
  it("goes to their direct space, made on first use, naming the direction and the recorder's account", () => {
    expect(personTransferRequest({ mode: "TO", personId: juan.memberId, placeIndex: 0 }, juan, base)).toEqual(
      {
        path: "direct",
        body: {
          date: "2026-11-14",
          amount: base.amount,
          accountId: "a-bank",
          direction: "TO",
          counterpart: { kind: "MEMBER", memberId: "m-juan-h" },
        },
      },
    );
  });

  it("goes to a group they share as a settlement between their member ids, the recorder's account on its side", () => {
    expect(personTransferRequest({ mode: "TO", personId: juan.memberId, placeIndex: 1 }, juan, base)).toEqual(
      {
        path: "space",
        spaceId: "sp-home",
        body: {
          date: "2026-11-14",
          amount: base.amount,
          payerMemberId: "m-ana-h",
          receivingMemberId: "m-juan-h",
          sourceAccountId: "a-bank",
        },
      },
    );
    expect(
      personTransferRequest({ mode: "FROM", personId: juan.memberId, placeIndex: 1 }, juan, base).body,
    ).toMatchObject({
      payerMemberId: "m-juan-h",
      receivingMemberId: "m-ana-h",
      destinationAccountId: "a-bank",
    });
  });

  it("reads what the two owe each other in the space from its pair suggestions only", () => {
    const suggestions = [
      { payerMemberId: "m-ana-h", receivingMemberId: "m-juan-h", amount: { amount: "10000000" } },
      { payerMemberId: "m-luis", receivingMemberId: "m-ana-h", amount: { amount: "999" } },
    ];
    expect(debtWith(suggestions, "m-ana-h", "m-juan-h")).toBe(10_000_000n);
    expect(debtWith(suggestions, "m-juan-h", "m-ana-h")).toBe(-10_000_000n);
    expect(debtWith([], "m-ana-h", "m-juan-h")).toBe(0n);
  });

  it("says the effect in that space: pays part, settles, settles and lends, or adds to what they owe", () => {
    expect(effectOf("TO", 100n, 50n)).toEqual({ key: "partial", amount: 50n, rest: 50n });
    expect(effectOf("TO", 100n, 100n)).toEqual({ key: "settle" });
    expect(effectOf("TO", 100n, 150n)).toEqual({ key: "over", debt: 100n, rest: 50n });
    expect(effectOf("TO", 0n, 150n)).toEqual({ key: "owes", total: 150n });
    expect(effectOf("TO", -20n, 150n)).toEqual({ key: "owes", total: 170n });
    expect(effectOf("FROM", -100n, 50n)).toEqual({ key: "theirPartial", amount: 50n, rest: 50n });
    expect(effectOf("FROM", -100n, 100n)).toEqual({ key: "theirSettle" });
    expect(effectOf("FROM", -100n, 150n)).toEqual({ key: "theirOver", debt: 100n, rest: 50n });
    expect(effectOf("FROM", 30n, 150n)).toEqual({ key: "youOwe", total: 180n });
  });
});
