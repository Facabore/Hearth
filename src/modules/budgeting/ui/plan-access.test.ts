import { describe, expect, it } from "vitest";
import { HOUSEHOLD_MEMBERS, referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { canCloseOn, canManage, capacityEditable, closesFrom, isEditable, memberOf } from "./plan-access";

const [ana, juan] = HOUSEHOLD_MEMBERS as [(typeof HOUSEHOLD_MEMBERS)[0], (typeof HOUSEHOLD_MEMBERS)[0]];

describe("who may change a plan (ruling P207)", () => {
  it("lets OWNER and ADMIN manage, and nobody else", () => {
    expect((["OWNER", "ADMIN", "MEMBER", "VIEWER", null] as const).map(canManage)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("lets a MEMBER change only their own capacity (D17)", () => {
    expect(capacityEditable("MEMBER", juan, "u-juan")).toBe(true);
    expect(capacityEditable("MEMBER", ana, "u-juan")).toBe(false);
    expect(capacityEditable("VIEWER", juan, "u-juan")).toBe(false);
    expect(capacityEditable("ADMIN", ana, "u-juan")).toBe(true);
    expect(memberOf(HOUSEHOLD_MEMBERS, "u-juan")?.id).toBe("m-juan");
    expect(memberOf(HOUSEHOLD_MEMBERS, "u-luis")).toBeNull();
  });

  it("closes an ACTIVE plan from the day after its period, and never edits a CLOSED one (HU-E6-07)", () => {
    const active = referencePlanDto({ status: "ACTIVE" });
    expect(closesFrom(active)).toBe("2026-12-01");
    expect(canCloseOn(active, "2026-11-30")).toBe(false);
    expect(canCloseOn(active, "2026-12-01")).toBe(true);
    expect(canCloseOn(referencePlanDto(), "2026-12-01")).toBe(false);
    expect(isEditable(active)).toBe(true);
    expect(isEditable(referencePlanDto({ status: "CLOSED" }))).toBe(false);
  });
});
