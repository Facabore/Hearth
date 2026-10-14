import { describe, expect, it } from "vitest";
import type { Id, Result } from "@/shared/kernel";
import {
  availableDisplayName,
  changeMemberRole,
  claimedGuest,
  currentGuest,
  ensureNameAvailable,
  ensureSettled,
  guestMember,
  leavingMember,
  memberName,
  outstandingIn,
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

describe("leaving (HU-E1-08)", () => {
  it("lets a current member leave", () => {
    expect(leavingMember(current, "luis")).toEqual({ ok: true, value: luis });
  });

  it("keeps the only OWNER, but lets an owner leave once another OWNER exists", () => {
    expect(code(leavingMember(current, "ana"))).toBe("LastOwnerRequired");
    const twoOwners = [ana, { ...luis, role: "OWNER" as const }];
    expect(code(leavingMember(twoOwners, "ana"))).toBe("ok");
  });

  it("reports someone who is not a current member as MemberNotFound", () => {
    expect(code(leavingMember(current, "nobody"))).toBe("MemberNotFound");
  });
});

describe("removing guests (HU-E1-12)", () => {
  it("finds a current guest", () => {
    expect(currentGuest(current, "pedro")).toEqual({ ok: true, value: pedro });
  });

  it("never treats a registered member as a guest", () => {
    expect(code(currentGuest(current, "luis"))).toBe("NotAGuest");
  });

  it("reports unknown and malformed ids as MemberNotFound", () => {
    expect(code(currentGuest(current, "nobody"))).toBe("MemberNotFound");
    expect(code(currentGuest(current, "not-a-uuid"))).toBe("MemberNotFound");
  });
});

describe("settled balances (HU-E1-08, HU-E1-09, HU-E1-12)", () => {
  it("lets settled members go", () => {
    expect(ensureSettled(outstandingIn([0n, 0n]), "COP")).toEqual({ ok: true, value: undefined });
  });

  it("reports what one member owes or is owed as a positive outstanding amount (Review Focus 1)", () => {
    expect(outstandingIn([-15_000_000n])).toBe(15_000_000n);
    expect(outstandingIn([5_000_000n])).toBe(5_000_000n);
  });

  it("totals what is owed among several members, also when only debtors are listed", () => {
    expect(outstandingIn([15_000_000n, -10_000_000n, -5_000_000n])).toBe(15_000_000n);
    expect(outstandingIn([-5_000_000n, -2_000_000n])).toBe(7_000_000n);
  });

  it("refuses an outstanding amount with OutstandingBalance, carrying it in minor units", () => {
    expect(ensureSettled(15_000_000n, "COP")).toEqual({
      ok: false,
      error: {
        code: "OutstandingBalance",
        details: { outstanding: { amount: "15000000", currency: "COP" } },
      },
    });
  });
});

describe("claiming a guest's place (HU-E1-11)", () => {
  const pedroWithEmail: SpaceMember = { ...pedro, contactEmail: "pedro@example.com" };
  const withPedro = [ana, luis, pedroWithEmail];

  it("turns the guest into a registered MEMBER with the same id and name and no contact email", () => {
    expect(claimedGuest(withPedro, "pedro", { userId: "u-pedro", spaceKind: "SHARED" })).toEqual({
      ok: true,
      value: { ...pedro, kind: "USER", userId: "u-pedro", role: "MEMBER", contactEmail: null },
    });
  });

  it("makes the claimer of a direct space's guest an OWNER, like its other member (D16)", () => {
    const claimed = claimedGuest([ana, pedro], "pedro", { userId: "u-pedro", spaceKind: "DIRECT" });
    expect(claimed.ok && claimed.value.role).toBe("OWNER");
  });

  it("answers GuestAlreadyClaimed for a registered member and MemberNotFound for anyone not current", () => {
    const claim = { userId: "u-pedro", spaceKind: "SHARED" } as const;
    expect(code(claimedGuest(withPedro, "luis", claim))).toBe("GuestAlreadyClaimed");
    expect(code(claimedGuest(withPedro, "nobody", claim))).toBe("MemberNotFound");
  });
});
