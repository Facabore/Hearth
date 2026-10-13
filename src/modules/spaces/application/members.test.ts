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
import type { Space, SpaceMember } from "../domain/space";
import { createChangeMemberRole } from "./change-member-role";
import { createListMembers } from "./list-members";
import type { MembersDeps } from "./members-deps";
import { createSpaceAccess } from "./space-access";

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
  return { store, deps, list: createListMembers(deps), changeRole: createChangeMemberRole(deps) };
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
