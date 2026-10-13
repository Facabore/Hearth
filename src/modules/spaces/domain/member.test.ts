import { describe, expect, it } from "vitest";
import type { Id, Result } from "@/shared/kernel";
import {
  availableDisplayName,
  changeMemberRole,
  ensureNameAvailable,
  guestMember,
  memberName,
  userMember,
} from "./member";
import type { SpaceMember, SpaceRole } from "./space";

const now = new Date("2026-10-13T12:00:00Z");
const code = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);
const member = (id: string, displayName: string, role: SpaceRole | null): SpaceMember => ({
  id: id as Id<"SpaceMember">,
  kind: role === null ? "GUEST" : "USER",
  userId: role === null ? null : `u-${id}`,
  displayName,
  role,
  contactEmail: null,
  joinedAt: now,
});
const ana = member("ana", "Ana", "OWNER");
const luis = member("luis", "Luis", "MEMBER");
const pedro = member("pedro", "Pedro", null);
const current = [ana, luis, pedro];

describe("guest members (HU-E1-10)", () => {
  it("have no user and no role, a trimmed name and a lower-cased contact email", () => {
    const guest = guestMember({
      id: "g-1" as Id<"SpaceMember">,
      displayName: " Marta ",
      contactEmail: " Marta@Example.com ",
      now,
      current,
    });
    expect(guest).toEqual({
      ok: true,
      value: {
        id: "g-1",
        kind: "GUEST",
        userId: null,
        displayName: "Marta",
        role: null,
        contactEmail: "marta@example.com",
        joinedAt: now,
      },
    });
  });

  it("may have no contact email", () => {
    const guest = guestMember({
      id: "g-1" as Id<"SpaceMember">,
      displayName: "Marta",
      contactEmail: null,
      now,
      current,
    });
    expect(guest.ok && guest.value.contactEmail).toBeNull();
  });

  it("need a name unique among current members of both kinds, ignoring case", () => {
    for (const taken of ["pedro", "ANA"]) {
      const guest = guestMember({
        id: "g-1" as Id<"SpaceMember">,
        displayName: taken,
        contactEmail: null,
        now,
        current,
      });
      expect(code(guest)).toBe("MemberNameTaken");
    }
    expect(code(ensureNameAvailable(current, "LUIS"))).toBe("MemberNameTaken");
    expect(code(ensureNameAvailable(current, "Sofi"))).toBe("ok");
  });

  it("need a name of 1 to 100 characters", () => {
    expect(code(memberName("   "))).toBe("InvalidMemberName");
    expect(code(memberName("x".repeat(101)))).toBe("InvalidMemberName");
    expect(memberName(`  ${"x".repeat(100)}  `)).toEqual({ ok: true, value: "x".repeat(100) });
  });
});

describe("registered members joining (HU-E1-07)", () => {
  it("take their account name and the invited role", () => {
    expect(
      userMember({
        id: "m-9" as Id<"SpaceMember">,
        userId: "u-juan",
        userName: "Juan",
        role: "MEMBER",
        now,
        current,
      }),
    ).toEqual({
      id: "m-9",
      kind: "USER",
      userId: "u-juan",
      displayName: "Juan",
      role: "MEMBER",
      contactEmail: null,
      joinedAt: now,
    });
  });

  it("get the first free numbered name when theirs is taken", () => {
    expect(availableDisplayName(current, "Juan")).toBe("Juan");
    expect(availableDisplayName(current, "ana")).toBe("ana 2");
    expect(availableDisplayName([...current, member("ana2", "Ana 2", "MEMBER")], "Ana")).toBe("Ana 3");
  });

  it("keep numbered names within 100 characters, suffix included", () => {
    const long = "x".repeat(100);
    const name = availableDisplayName([...current, member("long", long, "MEMBER")], long);
    expect(name).toBe(`${"x".repeat(98)} 2`);
    expect(name).toHaveLength(100);
  });

  it("skip names the database already refused, ignoring case", () => {
    expect(availableDisplayName(current, "Juan", ["juan"])).toBe("Juan 2");
    expect(
      userMember({
        id: "m-9" as Id<"SpaceMember">,
        userId: "u-juan",
        userName: "Juan",
        role: "MEMBER",
        now,
        current,
        alsoTaken: ["Juan", "Juan 2"],
      }).displayName,
    ).toBe("Juan 3");
  });
});

describe("changing roles (HU-E1-05)", () => {
  it("gives a registered member a new role", () => {
    expect(changeMemberRole(current, "luis", "ADMIN")).toEqual({
      ok: true,
      value: { ...luis, role: "ADMIN" },
    });
  });

  it("keeps at least one OWNER", () => {
    expect(code(changeMemberRole(current, "ana", "ADMIN"))).toBe("LastOwnerRequired");
    const twoOwners = [ana, { ...luis, role: "OWNER" as const }];
    expect(code(changeMemberRole(twoOwners, "ana", "ADMIN"))).toBe("ok");
  });

  it("never gives a guest a role", () => {
    expect(code(changeMemberRole(current, "pedro", "MEMBER"))).toBe("GuestHasNoRole");
  });

  it("reports unknown or malformed member ids as MemberNotFound", () => {
    expect(code(changeMemberRole(current, "nobody", "ADMIN"))).toBe("MemberNotFound");
    expect(code(changeMemberRole(current, "not-a-uuid", "ADMIN"))).toBe("MemberNotFound");
  });
});
