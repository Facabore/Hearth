import {
  effectiveStatus,
  isSingleUse,
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
  /** #218, ruling P264: whether it admits one person only (email invitations, claim links, ADMIN links). */
  readonly singleUse: boolean;
  /**
   * #218, ruling P264: how many people joined through a link invitation, as recorded since #218; null for email
   * invitations and claim links.
   */
  readonly uses: number | null;
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
  singleUse: isSingleUse(invitation),
  uses: invitation.kind === "LINK" ? invitation.joins.length : null,
});
