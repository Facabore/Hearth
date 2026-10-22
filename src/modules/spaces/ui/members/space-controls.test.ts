import { describe, expect, it } from "vitest";
import { can } from "@/modules/spaces/domain/permissions";
import { controlsFor, SPACE_CONTROLS, type MemberControls } from "./space-controls";

const ACTIONS = {
  invite: "member.invite",
  addGuest: "guest.add",
  changeRoles: "member.changeRole",
  claimLinks: "member.invite",
  removeGuests: "guest.remove",
  recordMoney: "money.record",
  manageFunds: "fund.manage",
} as const satisfies Record<keyof MemberControls, string>;
const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

describe("space controls (HU-E9-05, ruling P158)", () => {
  it("gives each control exactly the roles the domain's permission matrix gives its action", () => {
    for (const [control, action] of Object.entries(ACTIONS))
      for (const role of ROLES)
        expect([
          control,
          role,
          (SPACE_CONTROLS[control as keyof MemberControls] as readonly string[]).includes(role),
        ]).toEqual([control, role, can(role, action)]);
  });

  it("shows Luis, a MEMBER, Add guest but not Invite, and Sofi, a VIEWER, neither", () => {
    expect(controlsFor("MEMBER", "SHARED")).toMatchObject({
      invite: false,
      addGuest: true,
      changeRoles: false,
    });
    expect(Object.values(controlsFor("VIEWER", "SHARED")).some(Boolean)).toBe(false);
    expect(Object.values(controlsFor(null, "SHARED")).some(Boolean)).toBe(false);
  });

  it("lets only an OWNER or ADMIN of a shared space create a fund (U1)", () => {
    expect(controlsFor("OWNER", "SHARED").manageFunds).toBe(true);
    expect(controlsFor("ADMIN", "SHARED").manageFunds).toBe(true);
    expect(controlsFor("MEMBER", "SHARED").manageFunds).toBe(false);
    expect(controlsFor("OWNER", "PERSONAL").manageFunds).toBe(false);
  });

  it("offers no invitation, guest or role control in a direct space, only its guest's claim link", () => {
    expect(controlsFor("OWNER", "DIRECT")).toEqual({
      invite: false,
      addGuest: false,
      changeRoles: false,
      claimLinks: true,
      removeGuests: false,
      recordMoney: true,
      manageFunds: false,
    });
  });
});
