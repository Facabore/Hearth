import { describe, expect, it } from "vitest";
import { includedIds } from "./split-summary";
import type { SplitDraft } from "./split-request";

const draft = (overrides: Partial<SplitDraft> = {}): SplitDraft => ({
  payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
  method: "EQUAL",
  selected: ["m-ana", "m-juan", "m-luis"],
  values: {},
  chosen: false,
  ...overrides,
});
const JOIN_ORDER = ["m-ana", "m-juan", "m-luis"];

describe("who a split includes (U2)", () => {
  it("lists the selected members in join order, whatever the order they were picked in", () => {
    expect(includedIds(draft({ selected: ["m-luis", "m-ana"] }), JOIN_ORDER, null)).toEqual([
      "m-ana",
      "m-luis",
    ]);
  });

  it("lists the members the plan gives a share to when the plan's split is the method", () => {
    const allocation = [
      { memberId: "m-ana", amount: "80000000" },
      { memberId: "m-juan", amount: "0" },
      { memberId: "m-luis", amount: "120000000" },
    ];
    expect(includedIds(draft({ method: "BY_ALLOCATION" }), JOIN_ORDER, allocation)).toEqual([
      "m-ana",
      "m-luis",
    ]);
  });

  it("falls back to the selection while the plan's shares are not known yet", () => {
    expect(includedIds(draft({ method: "BY_ALLOCATION" }), JOIN_ORDER, null)).toEqual(JOIN_ORDER);
  });

  it("ignores a selected id that is no longer a member", () => {
    expect(includedIds(draft({ selected: ["m-ana", "m-gone"] }), JOIN_ORDER, null)).toEqual(["m-ana"]);
  });
});
