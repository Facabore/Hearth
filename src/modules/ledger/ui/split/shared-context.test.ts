import { describe, expect, it } from "vitest";
import { accountDto, guestDto, memberDto } from "../../../../../tests/support/ui/dto";
import { initialSplitDraft, sharedContextOf } from "./shared-context";

const MEMBERS = [
  memberDto(),
  memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" }),
  guestDto(),
];

describe("sharedContextOf (HU-E9-06, ruling P168)", () => {
  it("pays from the person's own accounts (personal space first) and offers the space's active funds", () => {
    const context = sharedContextOf({
      meUserId: "u-ana",
      members: MEMBERS,
      personalAccounts: [
        accountDto({ id: "a-bank", name: "Bancolombia" }),
        accountDto({ id: "a-old", archivedAt: "2026-10-01T00:00:00.000Z" }),
      ],
      spaceAccounts: [
        accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null }),
        accountDto({ id: "a-cash", name: "Caja de Ana", ownerUserId: "u-ana" }),
        accountDto({ id: "a-luis", name: "Caja de Luis", ownerUserId: "u-luis" }),
        accountDto({
          id: "a-gone-fund",
          type: "SHARED_FUND",
          ownerUserId: null,
          archivedAt: "2026-10-02T00:00:00.000Z",
        }),
      ],
    });
    expect(context?.meMemberId).toBe("m-ana");
    expect(context?.myAccounts.map((a) => a.id)).toEqual(["a-bank", "a-cash"]);
    expect(context?.funds.map((a) => a.id)).toEqual(["a-fund"]);
    expect(initialSplitDraft(context!)).toEqual({
      payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
      method: "EQUAL",
      selected: ["m-ana", "m-luis", "m-pedro"],
      values: {},
      chosen: false,
    });
  });

  it("answers null for someone who is not a current member", () => {
    expect(
      sharedContextOf({ meUserId: "u-x", members: MEMBERS, personalAccounts: [], spaceAccounts: [] }),
    ).toBeNull();
  });
});
