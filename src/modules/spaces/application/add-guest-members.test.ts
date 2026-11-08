import { describe, expect, it } from "vitest";
import { FixedClock, type Result } from "@/shared/kernel";
import { codeOf, memoryTm, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import {
  HOUSEHOLD_MEMBERS,
  householdSpace,
  InMemorySpaceStore,
} from "../../../../tests/support/in-memory-spaces";
import { createPersonalSpace, type Space, type SpaceId, type SpaceMemberId } from "../domain/space";
import { createAddGuestMembers } from "./add-guest-members";
import { createSpaceAccess } from "./space-access";
import type { AddMemberOutcome } from "./space-member-repository";

const now = new Date("2026-11-08T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });
// Background: OWNER Ana, ADMIN Juan, MEMBER Luis and VIEWER Sofi (Pedro is not a member yet).
const withoutPedro = () => householdSpace(HOUSEHOLD_MEMBERS.filter((m) => m.displayName !== "Pedro"));

const setup = (seeded: Space = withoutPedro(), store = new InMemorySpaceStore()) => {
  store.seed(seeded);
  const addGuests = createAddGuestMembers({
    access: createSpaceAccess(store),
    members: store,
    ids: sequentialIds("member-new"),
    clock: new FixedClock(now),
    tm: memoryTm,
  });
  return { store, addGuests };
};
const names = (store: InMemorySpaceStore) => store.members(space).map((m) => m.displayName);
const guestOf = (result: Result<unknown>) => (result.ok ? undefined : result.error.details?.guest);

describe("AddGuestMembers (P309)", () => {
  it("adds several guests at once, in the order given, with no user and no role", async () => {
    const { addGuests, store } = setup();
    const added = unwrap(
      await addGuests({
        ...as("luis"),
        guests: [{ displayName: "Pedro", contactEmail: "Pedro@Example.com" }, { displayName: " Marta " }],
      }),
    );
    expect(added).toEqual([
      {
        id: "member-new-1",
        kind: "GUEST",
        userId: null,
        displayName: "Pedro",
        role: null,
        contactEmail: "pedro@example.com",
        joinedAt: now,
      },
      {
        id: "member-new-2",
        kind: "GUEST",
        userId: null,
        displayName: "Marta",
        role: null,
        contactEmail: null,
        joinedAt: now,
      },
    ]);
    expect(names(store)).toEqual(["Ana", "Juan", "Luis", "Sofi", "Pedro", "Marta"]);
  });

  it("adds nobody when a name is taken by a current member, and names that guest's index", async () => {
    const { addGuests, store } = setup();
    const result = await addGuests({
      ...as("luis"),
      guests: [{ displayName: "Pedro" }, { displayName: "luis" }, { displayName: "Marta" }],
    });
    expect(codeOf(result)).toBe("MemberNameTaken");
    expect(guestOf(result)).toBe(1);
    expect(names(store)).toEqual(["Ana", "Juan", "Luis", "Sofi"]);
  });

  it("refuses the second of two equal names in one batch, ignoring case", async () => {
    const { addGuests, store } = setup();
    const result = await addGuests({
      ...as("luis"),
      guests: [{ displayName: "Pedro" }, { displayName: "PEDRO" }],
    });
    expect(codeOf(result)).toBe("MemberNameTaken");
    expect(guestOf(result)).toBe(1);
    expect(names(store)).toEqual(["Ana", "Juan", "Luis", "Sofi"]);
  });

  it("names the guest whose name is invalid, and adds nobody", async () => {
    const { addGuests, store } = setup();
    const result = await addGuests({
      ...as("luis"),
      guests: [{ displayName: "Pedro" }, { displayName: "  " }],
    });
    expect(codeOf(result)).toBe("InvalidMemberName");
    expect(guestOf(result)).toBe(1);
    expect(names(store)).toEqual(["Ana", "Juan", "Luis", "Sofi"]);
  });

  it("does not let a viewer add guests", async () => {
    const { addGuests } = setup();
    expect(codeOf(await addGuests({ ...as("sofi"), guests: [{ displayName: "Pedro" }] }))).toBe(
      "InsufficientRole",
    );
  });

  it("refuses guests in a personal space", async () => {
    const { addGuests } = setup(
      createPersonalSpace({
        id: "space-ana" as SpaceId,
        memberId: "member-ana-personal" as SpaceMemberId,
        ownerUserId: "u-ana",
        ownerName: "Ana",
        now,
      }),
    );
    const result = await addGuests({
      spaceId: "space-ana",
      userId: "u-ana",
      guests: [{ displayName: "Pedro" }],
    });
    expect(codeOf(result)).toBe("PersonalSpaceNotShareable");
  });

  it("answers MemberNameTaken with the index when the database refuses a name a concurrent addition took", async () => {
    class RacingStore extends InMemorySpaceStore {
      override async addMember(spaceId: string, member: Parameters<InMemorySpaceStore["addMember"]>[1]) {
        if (member.displayName === "Marta") return "nameTaken" as AddMemberOutcome;
        return super.addMember(spaceId, member);
      }
    }
    const { addGuests } = setup(withoutPedro(), new RacingStore());
    const result = await addGuests({
      ...as("luis"),
      guests: [{ displayName: "Pedro" }, { displayName: "Marta" }],
    });
    expect(codeOf(result)).toBe("MemberNameTaken");
    expect(guestOf(result)).toBe(1);
  });
});
