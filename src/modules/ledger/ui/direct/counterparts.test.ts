import { describe, expect, it } from "vitest";
import { guestDto, householdSpace, memberDto, spaceDto } from "../../../../../tests/support/ui/dto";
import { peopleOf } from "./counterparts";

const ana = memberDto();
const juan = (id: string) => memberDto({ id, userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const luis = memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" });

describe("peopleOf (HU-E1-13, ruling P172)", () => {
  it("lists each co-member once, through their direct space when there is one, and only direct spaces' guests", () => {
    const spaces = [
      spaceDto(),
      householdSpace(),
      householdSpace({ id: "sp-ana-juan", name: "Ana & Juan", kind: "DIRECT" }),
      householdSpace({ id: "sp-ana-carlos", name: "Ana & Carlos", kind: "DIRECT" }),
    ];
    const people = peopleOf({
      meUserId: "u-ana",
      spaces,
      membersBySpace: {
        "sp-household": [ana, juan("m-juan-h"), luis, guestDto()],
        "sp-ana-juan": [memberDto({ id: "m-ana-d" }), juan("m-juan-d")],
        "sp-ana-carlos": [memberDto({ id: "m-ana-c" }), guestDto({ id: "m-carlos", displayName: "Carlos" })],
      },
    });
    expect(people).toEqual([
      { memberId: "m-carlos", name: "Carlos", isGuest: true, directSpace: "Ana & Carlos" },
      { memberId: "m-juan-d", name: "Juan", isGuest: false, directSpace: "Ana & Juan" },
      { memberId: "m-luis", name: "Luis", isGuest: false, directSpace: null },
    ]);
  });

  it("lists a co-member of two shared spaces once, and nobody for a space that could not be read", () => {
    const people = peopleOf({
      meUserId: "u-ana",
      spaces: [
        spaceDto(),
        householdSpace(),
        householdSpace({ id: "sp-trip", name: "Trip" }),
        householdSpace({ id: "sp-unread", name: "Unread" }),
      ],
      membersBySpace: {
        "sp-household": [ana, luis],
        "sp-trip": [ana, memberDto({ id: "m-luis-t", userId: "u-luis", displayName: "Luis" })],
      },
    });
    expect(people).toEqual([{ memberId: "m-luis", name: "Luis", isGuest: false, directSpace: null }]);
  });
});
