import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import {
  HOUSEHOLD_MEMBERS,
  householdSpace,
  InMemorySpaceStore,
} from "../../../../tests/support/in-memory-spaces";
import {
  createPersonalSpace,
  type Space,
  type SpaceId,
  type SpaceMember,
  type SpaceMemberId,
} from "../domain/space";
import { createAddGuestMember } from "./add-guest-member";
import { createChangeMemberRole } from "./change-member-role";
import { createListMembers } from "./list-members";
import type { MembersDeps } from "./members-deps";
import { createSpaceAccess } from "./space-access";
import type { AddMemberOutcome } from "./space-member-repository";

const now = new Date("2026-10-13T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

const setup = (seeded: Space = householdSpace()) => {
  const store = new InMemorySpaceStore();
  store.seed(seeded);
  const deps: MembersDeps = {
    access: createSpaceAccess(store),
    members: store,
    ids: sequentialIds("member-new"),
    clock: new FixedClock(now),
    tm: memoryTm,
  };
  return {
    store,
    deps,
    list: createListMembers(deps),
    changeRole: createChangeMemberRole(deps),
    addGuest: createAddGuestMember(deps),
  };
};
const roleOf = (store: InMemorySpaceStore, name: string) =>
  store.members(space).find((m) => m.displayName === name)?.role;

describe("ListMembers (HU-E1-05, HU-E1-10)", () => {
  it("lists the current members in join order, guests included, to any role", async () => {
    const { list } = setup();
    const members = unwrap(await list(as("sofi")));
    expect(members.map((m) => [m.displayName, m.kind, m.role])).toEqual([
      ["Ana", "USER", "OWNER"],
      ["Juan", "USER", "ADMIN"],
      ["Luis", "USER", "MEMBER"],
      ["Sofi", "USER", "VIEWER"],
      ["Pedro", "GUEST", null],
    ]);
  });

  it("hides the space from non-members", async () => {
    const { list } = setup();
    expect(codeOf(await list(as("marta")))).toBe("SpaceNotFound");
  });
});

describe("ChangeMemberRole (HU-E1-05)", () => {
  it("lets the owner make Luis an ADMIN", async () => {
    const { changeRole, store } = setup();
    const changed = unwrap(await changeRole({ ...as("ana"), memberId: "member-luis", role: "ADMIN" }));
    expect(changed).toMatchObject({ id: "member-luis", displayName: "Luis", role: "ADMIN" });
    expect(roleOf(store, "Luis")).toBe("ADMIN");
    expect(store.locked).toEqual([space]);
  });

  it("refuses to demote the only OWNER", async () => {
    const { changeRole, store } = setup();
    expect(codeOf(await changeRole({ ...as("ana"), memberId: "member-ana", role: "ADMIN" }))).toBe(
      "LastOwnerRequired",
    );
    expect(roleOf(store, "Ana")).toBe("OWNER");
  });

  it("lets an owner step down once another OWNER exists", async () => {
    const { changeRole, store } = setup();
    unwrap(await changeRole({ ...as("ana"), memberId: "member-juan", role: "OWNER" }));
    unwrap(await changeRole({ ...as("ana"), memberId: "member-ana", role: "ADMIN" }));
    expect([roleOf(store, "Ana"), roleOf(store, "Juan")]).toEqual(["ADMIN", "OWNER"]);
  });

  it.each([
    ["Juan (ADMIN) promoting himself to OWNER", "juan", "member-juan", "OWNER"],
    ["Luis (MEMBER) changing Sofi", "luis", "member-sofi", "MEMBER"],
    ["Sofi (VIEWER) promoting herself", "sofi", "member-sofi", "ADMIN"],
  ] as const)("refuses %s with InsufficientRole", async (_case, actor, memberId, role) => {
    const { changeRole, store } = setup();
    expect(codeOf(await changeRole({ ...as(actor), memberId, role }))).toBe("InsufficientRole");
    expect(store.members(space)).toEqual(HOUSEHOLD_MEMBERS);
  });

  it("never gives the guest a role", async () => {
    const { changeRole, store } = setup();
    expect(codeOf(await changeRole({ ...as("ana"), memberId: "member-pedro", role: "MEMBER" }))).toBe(
      "GuestHasNoRole",
    );
    expect(roleOf(store, "Pedro")).toBeNull();
  });

  it("reports unknown and malformed member ids as MemberNotFound", async () => {
    const { changeRole } = setup();
    for (const memberId of ["member-nobody", "not-a-uuid"]) {
      expect(codeOf(await changeRole({ ...as("ana"), memberId, role: "ADMIN" }))).toBe("MemberNotFound");
    }
  });

  it("hides the space from non-members", async () => {
    const { changeRole } = setup();
    expect(codeOf(await changeRole({ ...as("marta"), memberId: "member-luis", role: "ADMIN" }))).toBe(
      "SpaceNotFound",
    );
  });

  it("checks the actor again on the locked rows", async () => {
    // Ana's OWNER role was read before a concurrent change that made her ADMIN committed.
    const demoted = HOUSEHOLD_MEMBERS.map((m): SpaceMember =>
      m.displayName === "Ana"
        ? { ...m, role: "ADMIN" }
        : m.displayName === "Juan"
          ? { ...m, role: "OWNER" }
          : m,
    );
    const { deps, store } = setup(householdSpace(demoted));
    const stale = createChangeMemberRole({
      ...deps,
      access: fakeSpaceAccess(
        membership({ spaceId: space, memberId: "member-ana", spaceKind: "SHARED", name: "Household" }),
      ),
    });
    expect(codeOf(await stale({ ...as("ana"), memberId: "member-luis", role: "ADMIN" }))).toBe(
      "InsufficientRole",
    );
    expect(roleOf(store, "Luis")).toBe("MEMBER");
  });
});

describe("AddGuestMember (HU-E1-10)", () => {
  // Background: OWNER Ana, MEMBER Luis and VIEWER Sofi (Pedro is not a member yet).
  const withoutPedro = () => householdSpace(HOUSEHOLD_MEMBERS.filter((m) => m.displayName !== "Pedro"));

  it("lets a member add a guest with no user and no role", async () => {
    const { addGuest, store } = setup(withoutPedro());
    const pedro = unwrap(
      await addGuest({ ...as("luis"), displayName: "Pedro", contactEmail: "Pedro@Example.com" }),
    );
    expect(pedro).toEqual({
      id: "member-new-1",
      kind: "GUEST",
      userId: null,
      displayName: "Pedro",
      role: null,
      contactEmail: "pedro@example.com",
      joinedAt: now,
    });
    expect(store.members(space).at(-1)).toEqual(pedro);
  });

  it("lists the guest among the current members", async () => {
    const { addGuest, list } = setup(withoutPedro());
    unwrap(await addGuest({ ...as("luis"), displayName: "Pedro" }));
    const members = unwrap(await list(as("ana")));
    expect(members.map((m) => [m.displayName, m.kind])).toEqual([
      ["Ana", "USER"],
      ["Juan", "USER"],
      ["Luis", "USER"],
      ["Sofi", "USER"],
      ["Pedro", "GUEST"],
    ]);
  });

  it("does not let a viewer add guests", async () => {
    const { addGuest } = setup(withoutPedro());
    expect(codeOf(await addGuest({ ...as("sofi"), displayName: "Pedro" }))).toBe("InsufficientRole");
  });

  it("requires a name unique among current members, ignoring case", async () => {
    const { addGuest } = setup();
    expect(codeOf(await addGuest({ ...as("luis"), displayName: "pedro" }))).toBe("MemberNameTaken");
    expect(codeOf(await addGuest({ ...as("luis"), displayName: "   " }))).toBe("InvalidMemberName");
  });

  it("refuses guests in a personal space", async () => {
    const { addGuest, store } = setup();
    store.seed(
      createPersonalSpace({
        id: "space-ana" as SpaceId,
        memberId: "member-ana-personal" as SpaceMemberId,
        ownerUserId: "u-ana",
        ownerName: "Ana",
        now,
      }),
    );
    expect(codeOf(await addGuest({ spaceId: "space-ana", userId: "u-ana", displayName: "Pedro" }))).toBe(
      "PersonalSpaceNotShareable",
    );
  });

  it("answers MemberNameTaken when a concurrent addition takes the name first", async () => {
    class RacingStore extends InMemorySpaceStore {
      override async addMember(): Promise<AddMemberOutcome> {
        return "nameTaken";
      }
    }
    const store = new RacingStore();
    store.seed(withoutPedro());
    const addGuest = createAddGuestMember({
      access: createSpaceAccess(store),
      members: store,
      ids: sequentialIds("member-new"),
      clock: new FixedClock(now),
      tm: memoryTm,
    });
    expect(codeOf(await addGuest({ ...as("luis"), displayName: "Pedro" }))).toBe("MemberNameTaken");
  });
});

describe("direct spaces keep their two members (HU-E1-13, D16)", () => {
  const [ana, juan, , , pedro] = HOUSEHOLD_MEMBERS;
  const direct = (members: SpaceMember[], name: string): Space => ({
    ...householdSpace(members),
    kind: "DIRECT",
    name,
  });

  it("refuses a third member as a guest", async () => {
    const { addGuest, store } = setup(direct([ana!, pedro!], "Ana & Pedro"));
    expect(codeOf(await addGuest({ ...as("ana"), displayName: "Luis" }))).toBe("DirectSpaceIsFull");
    expect(store.members(space)).toHaveLength(2);
  });

  it("keeps both registered members OWNER", async () => {
    const { changeRole, store } = setup(direct([ana!, { ...juan!, role: "OWNER" }], "Ana & Juan"));
    expect(codeOf(await changeRole({ ...as("ana"), memberId: "member-juan", role: "MEMBER" }))).toBe(
      "DirectSpaceMembersFixed",
    );
    expect(roleOf(store, "Juan")).toBe("OWNER");
  });

  it("answers PersonalSpaceNotShareable to a role change in a personal space", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    const { changeRole } = setup(personal);
    const demotion = {
      spaceId: "space-ana",
      userId: "u-ana",
      memberId: "member-ana-personal",
      role: "ADMIN" as const,
    };
    expect(codeOf(await changeRole(demotion))).toBe("PersonalSpaceNotShareable");
  });
});
