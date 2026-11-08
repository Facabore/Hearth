import type { SpaceDto } from "@/shared/ui/api/dto";
import type { SpaceRole } from "../members/space-controls";

/** Ruling P309: what the space's own settings may offer the viewer for the space's life (HU-E1-08, HU-E1-09). */
export interface LifecycleControls {
  /** Leave a shared space; a personal or direct space keeps its members (D16). */
  readonly leave: boolean;
  /** Archive a shared or direct space; a personal one is never archived. */
  readonly archive: boolean;
}

/**
 * The UI's copy of the matrix's `space.leave` and `space.archive` (ruling P158), pinned to it by its test. It lives
 * apart from `SPACE_CONTROLS`, which every tab's shell loads: only the space's settings read it (ADR 0004).
 */
export const LIFECYCLE_CONTROLS = {
  leave: ["OWNER", "ADMIN", "MEMBER", "VIEWER"],
  archive: ["OWNER"],
} as const satisfies Record<keyof LifecycleControls, readonly SpaceRole[]>;

export const lifecycleFor = (role: SpaceRole | null, kind: SpaceDto["kind"]): LifecycleControls => {
  const has = (control: keyof LifecycleControls) =>
    role !== null && (LIFECYCLE_CONTROLS[control] as readonly SpaceRole[]).includes(role);
  return { leave: kind === "SHARED" && has("leave"), archive: kind !== "PERSONAL" && has("archive") };
};
