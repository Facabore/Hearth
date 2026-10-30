import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import { currentGuest, normalizedEmail } from "./member";
import type { SpaceId, SpaceMember, SpaceRole } from "./space";

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

/** #218, ruling P264: someone who joined a space through an invitation, recorded once per person. */
export interface InvitationJoin {
  readonly userId: string;
  readonly joinedAt: Date;
}

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
  /**
   * #218, ruling P264: who joined through it, oldest first, one entry per person. Recorded since #218 only, so a
   * link created before it may have been used by people it does not list.
   */
  readonly joins: readonly InvitationJoin[];
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
    joins: [],
  };
  return ok(invitation);
};

/** A pending invitation is EXPIRED from exactly its expiry instant on. */
export const effectiveStatus = (invitation: Invitation, now: Date): InvitationStatus =>
  invitation.status === "PENDING" && now.getTime() >= invitation.expiresAt.getTime()
    ? "EXPIRED"
    : invitation.status;

/**
 * HU-E1-07, HU-E1-11, #218 (ruling P264): email invitations, claim links and links granting ADMIN admit one person;
 * MEMBER and VIEWER links admit anyone holding them until they expire or are revoked.
 */
export const isSingleUse = (invitation: Invitation): boolean =>
  invitation.kind !== "LINK" || invitation.role === "ADMIN";

/**
 * HU-E1-07: what keeps `acceptor` from accepting; revocation and use are reported before expiry. A single-use
 * invitation is used once it is ACCEPTED or anyone joined through it (#218, ruling P264).
 */
export const ensureAcceptable = (
  invitation: Invitation,
  acceptor: { readonly email: string; readonly now: Date },
): Result<void> => {
  if (invitation.status === "REVOKED") return err(domainError("InvitationRevoked"));
  if (invitation.status === "ACCEPTED" || (isSingleUse(invitation) && invitation.joins.length > 0)) {
    return err(domainError("InvitationAlreadyUsed"));
  }
  if (effectiveStatus(invitation, acceptor.now) === "EXPIRED") return err(domainError("InvitationExpired"));
  if (invitation.email !== null && invitation.email !== normalizedEmail(acceptor.email)) {
    return err(domainError("InvitationEmailMismatch"));
  }
  return ok(undefined);
};

/**
 * HU-E1-07, HU-E1-11, #218 (ruling P264): `userId` used the invitation at `now`. Whoever joins a space through an
 * email invitation or a link is recorded once (a person who left and joins again keeps their first join); a claim
 * link hands over a guest's place, so nobody joins through it. Single-use invitations are used up: ACCEPTED by
 * `userId`; MEMBER and VIEWER links stay pending until they expire or are revoked.
 */
export const markAccepted = (invitation: Invitation, userId: string, now: Date): Invitation => {
  const joins =
    isClaim(invitation) || invitation.joins.some((j) => j.userId === userId)
      ? invitation.joins
      : [...invitation.joins, { userId, joinedAt: now }];
  return isSingleUse(invitation)
    ? { ...invitation, joins, status: "ACCEPTED", acceptedAt: now, acceptedByUserId: userId }
    : { ...invitation, joins };
};

/** HU-E1-06: revoke a pending (or expired) invitation; revoking twice changes nothing. */
export const revokeInvitation = (invitation: Invitation, now: Date): Result<Invitation> => {
  if (invitation.status === "REVOKED") return ok(invitation);
  if (invitation.status === "ACCEPTED") return err(domainError("InvitationAlreadyUsed"));
  const revoked: Invitation = { ...invitation, status: "REVOKED", revokedAt: now };
  return ok(revoked);
};

/** HU-E1-11: claim links hand over a guest's place; they never add a member. */
export const isClaim = (invitation: Invitation): boolean => invitation.kind === "CLAIM";

/**
 * HU-E1-11: a single-use bearer link for one guest, valid 7 days and not bound to the guest's contact
 * email. It is stored as MEMBER; claiming grants MEMBER, or OWNER in a direct space (claimedGuest, D16).
 * `current` are the space's current members (the caller loads them for `spaceId`): the guest must be
 * one of them and still a guest, which the schema cannot check (migration 0009 only ties the id to a member).
 */
export const issueClaim = (input: {
  id: InvitationId;
  spaceId: SpaceId;
  guestMemberId: string;
  current: readonly SpaceMember[];
  tokenHash: string;
  createdBy: string;
  now: Date;
}): Result<Invitation> => {
  const guest = currentGuest(input.current, input.guestMemberId);
  if (!guest.ok) return guest;
  const claim: Invitation = {
    id: input.id,
    spaceId: input.spaceId,
    kind: "CLAIM",
    email: null,
    guestMemberId: guest.value.id,
    role: "MEMBER",
    tokenHash: input.tokenHash,
    status: "PENDING",
    createdBy: input.createdBy,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + INVITATION_TTL_MS),
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    joins: [],
  };
  return ok(claim);
};

/** HU-E1-11: what keeps a claim link from being used; a used link answers GuestAlreadyClaimed. */
export const ensureClaimable = (claim: Invitation, now: Date): Result<void> => {
  if (claim.status === "REVOKED") return err(domainError("InvitationRevoked"));
  if (claim.status === "ACCEPTED") return err(domainError("GuestAlreadyClaimed"));
  return effectiveStatus(claim, now) === "EXPIRED" ? err(domainError("InvitationExpired")) : ok(undefined);
};
