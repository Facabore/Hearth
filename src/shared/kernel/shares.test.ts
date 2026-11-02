import { describe, expect, it } from "vitest";
import { positiveShares } from "./shares";

describe("positiveShares (spec 5.3, ruling P285)", () => {
  it("answers the shares when every one is positive", () => {
    expect(positiveShares([1n, 40_000_050n, 60_000_100n])).toEqual({
      ok: true,
      value: [1n, 40_000_050n, 60_000_100n],
    });
  });

  it.each<[string, bigint[]]>([
    ["a zero share among positive ones", [100n, 0n]],
    ["a single zero share", [0n]],
    ["a negative share", [5n, -1n]],
  ])("refuses %s with InvalidSplit (shareNotPositive)", (_, parts) => {
    expect(positiveShares(parts)).toEqual({
      ok: false,
      error: { code: "InvalidSplit", details: { reason: "shareNotPositive" } },
    });
  });
});
