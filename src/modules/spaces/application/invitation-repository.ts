import type { Invitation } from "../domain/invitation";
import type { SpaceId, SpaceMemberId } from "../domain/space";

export interface InvitationRepository {
  add(invitation: Invitation): Promise<void>;
  /** The invitation of that space, locked until the transaction ends; null for unknown, foreign or malformed ids. */
  findForUpdate(spaceId: string, invitationId: string): Promise<Invitation | null>;
  /** The invitation whose token hashes to `tokenHash`, locked until the transaction ends; null when there is none. */
  findByTokenHashForUpdate(tokenHash: string): Promise<Invitation | null>;
  /**
   * HU-E9-05, ruling P155: the space's PENDING email and link invitations that have not expired at `now`, newest
   * first (created at, then id, descending); claim links are not listed; `[]` for a malformed id.
   */
  listPending(spaceId: string, now: Date): Promise<Invitation[]>;
  /** Persists status, acceptedAt, acceptedByUserId and revokedAt. */
  save(invitation: Invitation): Promise<void>;
}

/** HU-E1-12: a removed guest's claim links die with the guest's place. */
export interface ClaimLinkRepository {
  /** Revokes every pending claim link of the guest; used and revoked ones keep their status. */
  revokePendingClaims(spaceId: SpaceId, guestMemberId: SpaceMemberId, revokedAt: Date): Promise<void>;
}
