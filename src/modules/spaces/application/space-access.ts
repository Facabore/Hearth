import { domainError, err, flatMap, ok, type Result } from "@/shared/kernel";
import { can, rolesFor, type SpaceAction } from "../domain/permissions";
import type { SpaceRole } from "../domain/space";
import type { SpaceSummary } from "./space-repository";
import type { SpaceMembership, SpaceSettingsRepository } from "./space-settings-repository";

/** Resolves the acting user's membership; non-members get SpaceNotFound so existence never leaks (spec 8). */
export type SpaceAccess = (spaceId: string, userId: string) => Promise<Result<SpaceMembership>>;

export const createSpaceAccess =
  (spaces: Pick<SpaceSettingsRepository, "findMembership">): SpaceAccess =>
  async (spaceId, userId) => {
    const membership = await spaces.findMembership(spaceId, userId);
    return membership ? ok(membership) : err(domainError("SpaceNotFound"));
  };

/** Roles that manage a space's settings and catalog (HU-E1-03, HU-E3-02). */
export const MANAGERS: readonly SpaceRole[] = rolesFor("space.manage");
/** Roles that record money movements; VIEWER only reads. */
export const WRITERS: readonly SpaceRole[] = rolesFor("money.record");

export const requireRole = (
  membership: SpaceMembership,
  roles: readonly SpaceRole[],
): Result<SpaceMembership> =>
  membership.role !== null && roles.includes(membership.role)
    ? ok(membership)
    : err(domainError("InsufficientRole"));

/** HU-E1-05: the membership when the permission matrix lets its role perform `action`. */
export const requirePermission = (
  membership: SpaceMembership,
  action: SpaceAction,
): Result<SpaceMembership> =>
  can(membership.role, action) ? ok(membership) : err(domainError("InsufficientRole"));

/**
 * AuthorizeSpaceAction (HU-E1-05), used by every use case: membership first, so non-members get
 * SpaceNotFound whatever the action (spec 8), then the role.
 */
export const authorizeSpaceAction = async (
  access: SpaceAccess,
  spaceId: string,
  userId: string,
  action: SpaceAction,
): Promise<Result<SpaceMembership>> =>
  flatMap(await access(spaceId, userId), (m) => requirePermission(m, action));

export const toSpaceSummary = (m: SpaceMembership): SpaceSummary => ({
  id: m.spaceId,
  name: m.name,
  kind: m.spaceKind,
  currency: m.currency,
  periodPolicy: m.periodPolicy,
  role: m.role,
});
