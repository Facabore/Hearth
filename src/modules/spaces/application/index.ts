export type { Space, SpaceId, SpaceKind, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
export { ensureCanAddMember } from "../domain/space";
export { can, rolesFor, SPACE_ACTIONS, type SpaceAction } from "../domain/permissions";
export {
  createCreatePersonalSpace,
  type CreatePersonalSpace,
  type SpaceCreatedListener,
} from "./create-personal-space";
export { createGetSpace, type GetSpace } from "./get-space";
export { createListMySpaces, type ListMySpaces } from "./list-my-spaces";
export { createListSpacePeriods, type ListSpacePeriods, type StoredPeriodSource } from "./list-space-periods";
export {
  authorizeSpaceAction,
  createSpaceAccess,
  MANAGERS,
  requirePermission,
  requireRole,
  toSpaceSummary,
  WRITERS,
  type SpaceAccess,
} from "./space-access";
export type { SpaceRepository, SpaceSummary } from "./space-repository";
export type { SpaceMembership, SpaceSettings, SpaceSettingsRepository } from "./space-settings-repository";
export {
  createUpdateSpaceSettings,
  type SpaceSettingsChanges,
  type SpaceUsage,
  type UpdateSpaceSettings,
} from "./update-space-settings";
export type { AddMemberOutcome, SpaceMemberRepository } from "./space-member-repository";
export {
  createCreateSpace,
  type CreateSpace,
  type CreateSpaceDeps,
  type CreateSpaceInput,
} from "./create-space";
export { createChangeMemberRole, type ChangeMemberRole } from "./change-member-role";
export { createListMembers, type ListMembers } from "./list-members";
export type { MembersDeps } from "./members-deps";
