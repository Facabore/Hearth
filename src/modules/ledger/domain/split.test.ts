import { describe, expect, it } from "vitest";
import type { Money } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { splitShares, type SplitInput } from "./split";

// Current members of Household in join order.
const MEMBERS = ["member-ana", "member-juan", "member-luis"];
const pesos = (n: bigint) => money(n * 100n);
const equal = (...memberIds: string[]): SplitInput => ({
  method: "EQUAL",
  participants: memberIds.map((memberId) => ({ memberId })),
});
const amounts = (amount: Money, split: SplitInput) =>
  unwrap(splitShares(amount, split, MEMBERS)).map((share) => [share.memberId, share.amount] as const);

describe("equal split (HU-E4-07)", () => {
  it("splits 300,000 COP equally between Ana and Juan", () => {
    expect(unwrap(splitShares(pesos(300_000n), equal("member-ana", "member-juan"), MEMBERS))).toEqual([
      { memberId: "member-ana", amount: 15_000_000n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: 15_000_000n, splitMethod: "EQUAL" },
    ]);
  });

  it("gives the remainder peso to the earliest-joined participant, whatever the request order (Review Focus 1)", () => {
    const shares = amounts(pesos(100_000n), equal("member-luis", "member-juan", "member-ana"));
    expect(shares).toEqual([
      ["member-ana", 3_333_400n],
      ["member-juan", 3_333_300n],
      ["member-luis", 3_333_300n],
    ]);
    expect(shares.reduce((sum, [, amount]) => sum + amount, 0n)).toBe(10_000_000n);
  });

  it("keeps a sub-peso remainder on the first share so the total stays exact", () => {
    expect(amounts(money(10_050n), equal("member-ana", "member-juan"))).toEqual([
      ["member-ana", 5_050n],
      ["member-juan", 5_000n],
    ]);
  });

  it("requires at least one participant", () => {
    expect(codeOf(splitShares(pesos(80_000n), equal(), MEMBERS))).toBe("ParticipantsRequired");
  });

  it("rejects participants who are not current members, malformed ids included (Review Focus 2)", () => {
    expect(codeOf(splitShares(pesos(80_000n), equal("member-ana", "member-marta"), MEMBERS))).toBe(
      "NotASpaceMember",
    );
    expect(codeOf(splitShares(pesos(80_000n), equal("not-a-uuid"), MEMBERS))).toBe("NotASpaceMember");
  });

  it("rejects a participant listed twice (Review Focus 2)", () => {
    expect(codeOf(splitShares(pesos(80_000n), equal("member-ana", "member-ana"), MEMBERS))).toBe(
      "InvalidSplit",
    );
  });

  it("rejects an amount too small to give every participant a positive share (Review Focus 1)", () => {
    const tooSmall = splitShares(pesos(1n), equal("member-ana", "member-juan", "member-luis"), MEMBERS);
    expect(tooSmall).toEqual({
      ok: false,
      error: { code: "InvalidSplit", details: { reason: "shareNotPositive" } },
    });
  });
});
