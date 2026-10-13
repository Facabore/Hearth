import type { Invitation } from "../domain/invitation";

export interface InvitationRepository {
  add(invitation: Invitation): Promise<void>;
  /** The invitation of that space, locked until the transaction ends; null for unknown, foreign or malformed ids. */
  findForUpdate(spaceId: string, invitationId: string): Promise<Invitation | null>;
  /** The invitation whose token hashes to `tokenHash`, locked until the transaction ends; null when there is none. */
  findByTokenHashForUpdate(tokenHash: string): Promise<Invitation | null>;
  /** Persists status, acceptedAt, acceptedByUserId and revokedAt. */
  save(invitation: Invitation): Promise<void>;
}
