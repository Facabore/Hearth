import {
  effectiveStatus,
  type InvitableRole,
  type Invitation,
  type InvitationKind,
  type InvitationStatus,
} from "../domain/invitation";
import type { SpaceId } from "../domain/space";

/** What clients see of an invitation: never its token hash, with EXPIRED derived at `now`. */
export interface InvitationView {
  readonly id: string;
  readonly spaceId: SpaceId;
  readonly kind: InvitationKind;
  readonly email: string | null;
  readonly role: InvitableRole;
  readonly status: InvitationStatus;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

export const toInvitationView = (invitation: Invitation, now: Date): InvitationView => ({
  id: invitation.id,
  spaceId: invitation.spaceId,
  kind: invitation.kind,
  email: invitation.email,
  role: invitation.role,
  status: effectiveStatus(invitation, now),
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
});
