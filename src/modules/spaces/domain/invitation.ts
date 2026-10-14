import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import { normalizedEmail } from "./member";
import type { SpaceId, SpaceRole } from "./space";

export type InvitationId = Id<"Invitation">;
/** EMAIL and LINK invitations add a member (HU-E1-06); CLAIM links hand over a guest's place (HU-E1-11). */
export type InvitationKind = "EMAIL" | "LINK" | "CLAIM";
/** Stored lifecycle; EXPIRED is derived from expiresAt on read (effectiveStatus). */
export type InvitationState = "PENDING" | "ACCEPTED" | "REVOKED";
export type InvitationStatus = InvitationState | "EXPIRED";
/** HU-E1-06: invitations never grant OWNER. */
export type InvitableRole = Exclude<SpaceRole, "OWNER">;
/** Who may accept: one email address, or anyone holding the link. */
export type InvitationTarget = { readonly kind: "EMAIL"; readonly email: string } | { readonly kind: "LINK" };

/** HU-E1-06: invitations expire 7 days after creation. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Invitation {
  readonly id: InvitationId;
  readonly spaceId: SpaceId;
  readonly kind: InvitationKind;
  /** Trimmed and lower-cased; set only for EMAIL invitations, which only that address can accept. */
  readonly email: string | null;
  /** HU-E1-11: set only for CLAIM links, the guest whose place they hand over. */
  readonly guestMemberId: string | null;
  readonly role: InvitableRole;
  /** SHA-256 of the bearer token; the token itself is never stored (HU-E1-06). */
  readonly tokenHash: string;
  readonly status: InvitationState;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly acceptedByUserId: string | null;
  readonly revokedAt: Date | null;
}

/** HU-E1-06: a pending invitation for one address or for a shareable link, valid 7 days. */
export const issueInvitation = (input: {
  id: InvitationId;
  spaceId: SpaceId;
  target: InvitationTarget;
  role: SpaceRole;
  tokenHash: string;
  createdBy: string;
  now: Date;
}): Result<Invitation> => {
  const { role, target } = input;
  if (role === "OWNER") return err(domainError("InvalidInvitationRole"));
  let email: string | null = null;
  if (target.kind === "EMAIL") {
    email = normalizedEmail(target.email);
    if (email === "") return err(domainError("InvalidEmail"));
  }
  const invitation: Invitation = {
    id: input.id,
    spaceId: input.spaceId,
    kind: target.kind,
    email,
    guestMemberId: null,
    role,
    tokenHash: input.tokenHash,
    status: "PENDING",
    createdBy: input.createdBy,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
  };
  return ok(invitation);
};

/** A pending invitation is EXPIRED from exactly its expiry instant on. */
export const effectiveStatus = (invitation: Invitation, now: Date): InvitationStatus =>
  invitation.status === "PENDING" && now.getTime() >= invitation.expiresAt.getTime()
    ? "EXPIRED"
    : invitation.status;

/** HU-E1-07: what keeps `acceptor` from accepting; revocation and use are reported before expiry. */
export const ensureAcceptable = (
  invitation: Invitation,
  acceptor: { readonly email: string; readonly now: Date },
): Result<void> => {
  if (invitation.status === "REVOKED") return err(domainError("InvitationRevoked"));
  if (invitation.status === "ACCEPTED") return err(domainError("InvitationAlreadyUsed"));
  if (effectiveStatus(invitation, acceptor.now) === "EXPIRED") return err(domainError("InvitationExpired"));
  if (invitation.email !== null && invitation.email !== normalizedEmail(acceptor.email)) {
    return err(domainError("InvitationEmailMismatch"));
  }
  return ok(undefined);
};

/** HU-E1-07: email invitations are single-use; link invitations stay valid until expiry or revocation. */
export const markAccepted = (invitation: Invitation, userId: string, now: Date): Invitation =>
  invitation.kind === "EMAIL"
    ? { ...invitation, status: "ACCEPTED", acceptedAt: now, acceptedByUserId: userId }
    : invitation;

/** HU-E1-06: revoke a pending (or expired) invitation; revoking twice changes nothing. */
export const revokeInvitation = (invitation: Invitation, now: Date): Result<Invitation> => {
  if (invitation.status === "REVOKED") return ok(invitation);
  if (invitation.status === "ACCEPTED") return err(domainError("InvitationAlreadyUsed"));
  const revoked: Invitation = { ...invitation, status: "REVOKED", revokedAt: now };
  return ok(revoked);
};
