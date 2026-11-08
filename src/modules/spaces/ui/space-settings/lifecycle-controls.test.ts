import { describe, expect, it } from "vitest";
import { can } from "@/modules/spaces/domain/permissions";
import { LIFECYCLE_CONTROLS, lifecycleFor, type LifecycleControls } from "./lifecycle-controls";

const ACTIONS = { leave: "space.leave", archive: "space.archive" } as const satisfies Record<
  keyof LifecycleControls,
  string
>;
const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

describe("a space's lifecycle controls (ruling P309)", () => {
  it("gives each control exactly the roles the domain's permission matrix gives its action", () => {
    for (const [control, action] of Object.entries(ACTIONS))
      for (const role of ROLES)
        expect([
          control,
          role,
          (LIFECYCLE_CONTROLS[control as keyof LifecycleControls] as readonly string[]).includes(role),
        ]).toEqual([control, role, can(role, action)]);
  });

  it("lets anyone leave only a shared space, and only its OWNER archive a shared or direct one", () => {
    expect(lifecycleFor("VIEWER", "SHARED")).toEqual({ leave: true, archive: false });
    expect(lifecycleFor("OWNER", "SHARED")).toEqual({ leave: true, archive: true });
    expect(lifecycleFor("OWNER", "DIRECT")).toEqual({ leave: false, archive: true });
    expect(lifecycleFor("OWNER", "PERSONAL")).toEqual({ leave: false, archive: false });
    expect(lifecycleFor(null, "SHARED")).toEqual({ leave: false, archive: false });
  });
});
