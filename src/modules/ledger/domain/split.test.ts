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

describe("non-equal splits (HU-E4-08)", () => {
  const percent = (...points: [string, number][]): SplitInput => ({
    method: "PERCENT",
    participants: points.map(([memberId, basisPoints]) => ({ memberId, basisPoints })),
  });
  const exact = (...parts: [string, Money][]): SplitInput => ({
    method: "EXACT",
    participants: parts.map(([memberId, amount]) => ({ memberId, amount })),
  });
  const units = (...parts: [string, number][]): SplitInput => ({
    method: "SHARES",
    participants: parts.map(([memberId, count]) => ({ memberId, units: count })),
  });

  it("splits 300,000 COP 40% / 60%", () => {
    const split = percent(["member-ana", 4_000], ["member-juan", 6_000]);
    expect(unwrap(splitShares(pesos(300_000n), split, MEMBERS))).toEqual([
      { memberId: "member-ana", amount: 12_000_000n, splitMethod: "PERCENT" },
      { memberId: "member-juan", amount: 18_000_000n, splitMethod: "PERCENT" },
    ]);
  });

  it("accepts percentages with two decimals and still sums exactly (Review Focus 1)", () => {
    const split = percent(["member-ana", 3_333], ["member-juan", 3_333], ["member-luis", 3_334]);
    expect(amounts(pesos(100_000n), split)).toEqual([
      ["member-ana", 3_333_000n],
      ["member-juan", 3_333_000n],
      ["member-luis", 3_334_000n],
    ]);
  });

  it("rejects percentages that do not sum to 100 or are not positive", () => {
    expect(
      codeOf(splitShares(pesos(300_000n), percent(["member-ana", 4_000], ["member-juan", 5_000]), MEMBERS)),
    ).toBe("InvalidSplit");
    expect(
      codeOf(splitShares(pesos(300_000n), percent(["member-ana", 0], ["member-juan", 10_000]), MEMBERS)),
    ).toBe("InvalidSplit");
  });

  it("records exact amounts that add up to the expense", () => {
    const split = exact(["member-ana", pesos(100_000n)], ["member-juan", pesos(150_000n)]);
    expect(amounts(pesos(250_000n), split)).toEqual([
      ["member-ana", 10_000_000n],
      ["member-juan", 15_000_000n],
    ]);
  });

  it("rejects exact amounts that do not add up, are not positive or use another currency", () => {
    const short = exact(["member-ana", pesos(100_000n)], ["member-juan", pesos(120_000n)]);
    expect(codeOf(splitShares(pesos(250_000n), short, MEMBERS))).toBe("SharesDoNotMatchAmount");
    const negative = exact(["member-ana", pesos(260_000n)], ["member-juan", money(-1_000_000n)]);
    expect(codeOf(splitShares(pesos(250_000n), negative, MEMBERS))).toBe("InvalidSplit");
    const dollars = exact(["member-ana", pesos(100_000n)], ["member-juan", money(15_000_000n, "USD")]);
    expect(codeOf(splitShares(pesos(250_000n), dollars, MEMBERS))).toBe("CurrencyMismatch");
  });

  it("splits 90,000 COP by share units 2:1", () => {
    expect(amounts(pesos(90_000n), units(["member-ana", 2], ["member-juan", 1]))).toEqual([
      ["member-ana", 6_000_000n],
      ["member-juan", 3_000_000n],
    ]);
  });

  it("rejects share units that are not positive integers", () => {
    expect(codeOf(splitShares(pesos(90_000n), units(["member-ana", 0], ["member-juan", 0]), MEMBERS))).toBe(
      "InvalidSplit",
    );
    expect(codeOf(splitShares(pesos(90_000n), units(["member-ana", 1.5], ["member-juan", 1]), MEMBERS))).toBe(
      "InvalidSplit",
    );
  });

  it("orders non-equal shares by join order too", () => {
    const split = percent(["member-juan", 6_000], ["member-ana", 4_000]);
    expect(amounts(pesos(300_000n), split)).toEqual([
      ["member-ana", 12_000_000n],
      ["member-juan", 18_000_000n],
    ]);
  });
});
