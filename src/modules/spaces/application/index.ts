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
export { createAddGuestMember, type AddGuestMember } from "./add-guest-member";
export type {
  InvitableRole,
  Invitation,
  InvitationId,
  InvitationKind,
  InvitationState,
  InvitationStatus,
  InvitationTarget,
} from "../domain/invitation";
export type { InvitationRepository } from "./invitation-repository";
export type {
  EmailSender,
  InvitationEmail,
  InvitationsDeps,
  InvitationTokens,
  IssuedToken,
  RegisteredUsers,
} from "./invitation-ports";
export { toInvitationView, type InvitationView } from "./invitation-view";
export {
  createCreateInvitation,
  type CreatedInvitation,
  type CreateInvitation,
  type CreateInvitationInput,
} from "./create-invitation";
export { createRevokeInvitation, type RevokeInvitation } from "./revoke-invitation";
export {
  createAcceptInvitation,
  type AcceptInvitation,
  type AcceptInvitationInput,
} from "./accept-invitation";
export type { MemberLifecycleRepository } from "./space-member-repository";
export type { LifecycleDeps, MemberNetBalance } from "./lifecycle-deps";
export { createLeaveSpace, type LeaveSpace } from "./leave-space";
