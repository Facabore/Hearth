import { describe, expect, it } from "vitest";
import { defaultSplitMembers, positiveShares } from "./shares";

describe("defaultSplitMembers (spec 5.3, ruling P293)", () => {
  it("names every current member but the VIEWERs, guests included, in join order, and holds the VIEWERs apart", () => {
    const members = [
      { id: "member-ana", role: "OWNER" },
      { id: "member-sofi", role: "VIEWER" },
      { id: "member-juan", role: "MEMBER" },
      { id: "member-pedro", role: null },
      { id: "member-luis", role: "ADMIN" },
      { id: "member-marta", role: "VIEWER" },
    ] as const;
    expect(defaultSplitMembers(members)).toEqual({
      memberIds: ["member-ana", "member-juan", "member-pedro", "member-luis"],
      viewerIds: ["member-sofi", "member-marta"],
    });
  });

  it("holds no VIEWER apart in a space without one", () => {
    expect(defaultSplitMembers([{ id: "member-ana", role: "OWNER" }])).toEqual({
      memberIds: ["member-ana"],
      viewerIds: [],
    });
  });
});

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
