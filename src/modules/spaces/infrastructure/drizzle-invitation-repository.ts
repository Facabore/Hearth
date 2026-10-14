import { and, eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { InvitationRepository } from "../application/invitation-repository";
import type { Invitation, InvitationId } from "../domain/invitation";
import type { SpaceId } from "../domain/space";
import { spaceInvitations } from "./spaces.schema";

const toInvitation = (row: typeof spaceInvitations.$inferSelect): Invitation => ({
  ...row,
  id: row.id as InvitationId,
  spaceId: row.spaceId as SpaceId,
});

export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(invitation: Invitation): Promise<void> {
    await this.tm.executor().insert(spaceInvitations).values({
      id: invitation.id,
      spaceId: invitation.spaceId,
      kind: invitation.kind,
      email: invitation.email,
      guestMemberId: invitation.guestMemberId,
      role: invitation.role,
      tokenHash: invitation.tokenHash,
      status: invitation.status,
      createdBy: invitation.createdBy,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      acceptedByUserId: invitation.acceptedByUserId,
      revokedAt: invitation.revokedAt,
    });
  }

  async findForUpdate(spaceId: string, invitationId: string): Promise<Invitation | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId) || !isUuid(invitationId)) return null;
    const [row] = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(and(eq(spaceInvitations.spaceId, spaceId), eq(spaceInvitations.id, invitationId)))
      .for("update");
    return row ? toInvitation(row) : null;
  }

  async findByTokenHashForUpdate(tokenHash: string): Promise<Invitation | null> {
    const [row] = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(eq(spaceInvitations.tokenHash, tokenHash))
      .for("update");
    return row ? toInvitation(row) : null;
  }

  async save(invitation: Invitation): Promise<void> {
    await this.tm
      .executor()
      .update(spaceInvitations)
      .set({
        status: invitation.status,
        acceptedAt: invitation.acceptedAt,
        acceptedByUserId: invitation.acceptedByUserId,
        revokedAt: invitation.revokedAt,
      })
      .where(eq(spaceInvitations.id, invitation.id));
  }
}
