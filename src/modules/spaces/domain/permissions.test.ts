import { describe, expect, it } from "vitest";
import { can, isReadOnly, rolesFor, SPACE_ACTIONS, type SpaceAction } from "./permissions";
import type { SpaceRole } from "./space";

describe("permission matrix (HU-E1-05)", () => {
  // Background: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi; the guest Pedro has no role.
  it.each<[string, SpaceRole, SpaceAction, boolean]>([
    ["Ana archives the space", "OWNER", "space.archive", true],
    ["Juan archives the space", "ADMIN", "space.archive", false],
    ["Juan invites a member", "ADMIN", "member.invite", true],
    ["Luis invites a member", "MEMBER", "member.invite", false],
    ["Luis records an expense", "MEMBER", "money.record", true],
    ["Sofi records an expense", "VIEWER", "money.record", false],
    ["Luis edits an expense created by Ana", "MEMBER", "money.editAny", false],
    ["Juan edits an expense created by Ana", "ADMIN", "money.editAny", true],
    ["Sofi views balances", "VIEWER", "space.read", true],
    ["Luis adds a guest", "MEMBER", "guest.add", true],
    ["Sofi adds a guest", "VIEWER", "guest.add", false],
    ["Luis records an expense paid by Pedro", "MEMBER", "money.record", true],
    ["Sofi records a settlement for Pedro", "VIEWER", "money.record", false],
    ["Sofi leaves the space", "VIEWER", "space.leave", true],
    ["Luis removes the guest Pedro", "MEMBER", "guest.remove", true],
    ["Sofi removes the guest Pedro", "VIEWER", "guest.remove", false],
    ["Ana creates a plan", "OWNER", "plan.manage", true],
    ["Juan edits a plan", "ADMIN", "plan.manage", true],
    ["Luis creates a plan", "MEMBER", "plan.manage", false],
    ["Luis sets his own capacity", "MEMBER", "capacity.setOwn", true],
    ["Sofi sets her own capacity", "VIEWER", "capacity.setOwn", false],
  ])("%s", (_scenario, role, action, allowed) => {
    expect(can(role, action)).toBe(allowed);
  });

  it("lets only owners change roles, so nobody raises their own role", () => {
    expect(rolesFor("member.changeRole")).toEqual(["OWNER"]);
  });

  it("allows a guest, who has no role, nothing", () => {
    for (const action of SPACE_ACTIONS) expect(can(null, action)).toBe(false);
  });

  it("lets owners do everything and viewers only read or leave (HU-E1-08)", () => {
    for (const action of SPACE_ACTIONS) expect(can("OWNER", action)).toBe(true);
    expect(SPACE_ACTIONS.filter((action) => can("VIEWER", action))).toEqual(["space.read", "space.leave"]);
  });

  it("reads only with space.read, the one action an archived space still allows (HU-E1-09)", () => {
    expect(SPACE_ACTIONS.filter(isReadOnly)).toEqual(["space.read"]);
  });

  it("keeps shared fund management with owners and admins (HU-E2-02)", () => {
    expect(rolesFor("fund.manage")).toEqual(["OWNER", "ADMIN"]);
  });
});
