import type { SpaceDto } from "@/shared/ui/api/dto";

export type SpaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/** What the household screens may offer the viewer; each maps to one action of HU-E1-05's matrix. */
export interface MemberControls {
  readonly invite: boolean;
  readonly addGuest: boolean;
  readonly changeRoles: boolean;
  readonly claimLinks: boolean;
  readonly removeGuests: boolean;
  readonly recordMoney: boolean;
  /** Create a shared fund (U1). */
  readonly manageFunds: boolean;
}

/**
 * Ruling P158: the UI's copy of the matrix (`src/modules/spaces/domain/permissions.ts`) for these screens, pinned to it
 * by `space-controls.test.ts`. The UI may not import the domain (P119); the API stays the authority.
 */
export const SPACE_CONTROLS = {
  invite: ["OWNER", "ADMIN"],
  addGuest: ["OWNER", "ADMIN", "MEMBER"],
  changeRoles: ["OWNER"],
  claimLinks: ["OWNER", "ADMIN"],
  removeGuests: ["OWNER", "ADMIN", "MEMBER"],
  recordMoney: ["OWNER", "ADMIN", "MEMBER"],
  manageFunds: ["OWNER", "ADMIN"],
} as const satisfies Record<keyof MemberControls, readonly SpaceRole[]>;

/**
 * The controls a role gets in a space. D16: a direct space keeps its two members (no invitations, guests or role
 * changes), but its guest can still be handed a claim link (HU-E1-11); a personal space has none of these screens.
 */
export const controlsFor = (role: SpaceRole | null, kind: SpaceDto["kind"]): MemberControls => {
  const has = (control: keyof MemberControls) =>
    role !== null && (SPACE_CONTROLS[control] as readonly SpaceRole[]).includes(role);
  const shared = kind === "SHARED";
  return {
    invite: shared && has("invite"),
    addGuest: shared && has("addGuest"),
    changeRoles: shared && has("changeRoles"),
    claimLinks: kind !== "PERSONAL" && has("claimLinks"),
    removeGuests: shared && has("removeGuests"),
    recordMoney: has("recordMoney"),
    manageFunds: shared && has("manageFunds"),
  };
};
