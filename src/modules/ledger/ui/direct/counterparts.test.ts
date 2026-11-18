import { describe, expect, it } from "vitest";
import {
  friendDto,
  guestDto,
  householdSpace,
  memberDto,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
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
    // #338: the direct spaces' people come from Amigos' one read, the groups' from their members.
    const people = peopleOf({
      meUserId: "u-ana",
      spaces,
      friends: [
        friendDto({
          spaceId: "sp-ana-juan",
          me: { memberId: "m-ana-d" },
          other: {
            memberId: "m-juan-d",
            kind: "USER",
            displayName: "Juan",
            nickname: "Juancho",
            userId: "u-juan",
            handle: "juanp",
          },
          name: "Juancho",
        }),
        friendDto({
          spaceId: "sp-ana-carlos",
          me: { memberId: "m-ana-c" },
          other: { memberId: "m-carlos", kind: "GUEST", displayName: "Carlos", nickname: null },
          name: "Carlos",
        }),
        // A direct space the switcher no longer lists (archived meanwhile) adds nobody.
        friendDto({ spaceId: "sp-gone" }),
      ],
      membersBySpace: { "sp-household": [ana, juan("m-juan-h"), luis, guestDto()] },
    });
    const direct = (spaceId: string, name: string, theirs: string, mine: string) => ({
      spaceId,
      name,
      kind: "DIRECT",
      currency: "COP",
      theirMemberId: theirs,
      myMemberId: mine,
    });
    const household = (theirs: string) => ({
      spaceId: "sp-household",
      name: householdSpace().name,
      kind: "SHARED",
      currency: "COP",
      theirMemberId: theirs,
      myMemberId: ana.id,
    });
    // P334: where a transfer with each can go: the direct space first (to be made when there is none), then the groups.
    const notYet = {
      spaceId: null,
      name: null,
      kind: "DIRECT",
      currency: null,
      theirMemberId: null,
      myMemberId: null,
    };
    expect(people).toEqual([
      {
        memberId: "m-carlos",
        name: "Carlos",
        isGuest: true,
        directSpace: "Ana & Carlos",
        places: [direct("sp-ana-carlos", "Ana & Carlos", "m-carlos", "m-ana-c")],
        // P340: what a search finds them by and how recent they are, from Amigos' read.
        handle: undefined,
        nickname: null,
        lastMovement: "2025-03-12",
      },
      {
        memberId: "m-juan-d",
        name: "Juan",
        isGuest: false,
        directSpace: "Ana & Juan",
        places: [direct("sp-ana-juan", "Ana & Juan", "m-juan-d", "m-ana-d"), household("m-juan-h")],
        handle: "juanp",
        nickname: "Juancho",
        lastMovement: "2025-03-12",
      },
      {
        memberId: "m-luis",
        name: "Luis",
        isGuest: false,
        directSpace: null,
        places: [notYet, household("m-luis")],
      },
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
      friends: [],
      membersBySpace: {
        "sp-household": [ana, luis],
        "sp-trip": [ana, memberDto({ id: "m-luis-t", userId: "u-luis", displayName: "Luis" })],
      },
    });
    expect(people).toMatchObject([{ memberId: "m-luis", name: "Luis", isGuest: false, directSpace: null }]);
    expect(people[0]!.places.map((place) => place.spaceId)).toEqual([null, "sp-household", "sp-trip"]);
  });

  it("offers no transfer in a group where the recorder only reads, and names each place's currency (P334)", () => {
    const people = peopleOf({
      meUserId: "u-ana",
      spaces: [
        householdSpace(),
        householdSpace({ id: "sp-club", name: "Club", role: "VIEWER" }),
        householdSpace({ id: "sp-trip", name: "Trip", currency: "USD" }),
      ],
      friends: [],
      membersBySpace: {
        "sp-household": [ana, luis],
        "sp-club": [ana, memberDto({ id: "m-luis-c", userId: "u-luis", displayName: "Luis" })],
        "sp-trip": [ana, memberDto({ id: "m-luis-t", userId: "u-luis", displayName: "Luis" })],
      },
    });
    expect(people[0]!.places.map((place) => [place.spaceId, place.currency])).toEqual([
      [null, null],
      ["sp-household", "COP"],
      ["sp-trip", "USD"],
    ]);
  });
});
