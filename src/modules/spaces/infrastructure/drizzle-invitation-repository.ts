import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { InvitationRepository } from "../application/invitation-repository";
import type { Invitation, InvitationId, InvitationJoin } from "../domain/invitation";
import type { SpaceId, SpaceMemberId } from "../domain/space";
import { spaceInvitations, spaceInvitationUses } from "./spaces.schema";

const toInvitation = (
  row: typeof spaceInvitations.$inferSelect,
  joins: readonly InvitationJoin[],
): Invitation => ({
  ...row,
  id: row.id as InvitationId,
  spaceId: row.spaceId as SpaceId,
  joins,
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
    await this.addJoins(invitation);
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
    return this.withJoins(row);
  }

  async findByTokenHashForUpdate(tokenHash: string): Promise<Invitation | null> {
    const [row] = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(eq(spaceInvitations.tokenHash, tokenHash))
      .for("update");
    // Read after the row lock: a concurrent acceptance that held it has committed its joins by now (#218).
    return this.withJoins(row);
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const [row] = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(eq(spaceInvitations.tokenHash, tokenHash));
    return this.withJoins(row);
  }

  async listPending(spaceId: string, now: Date): Promise<Invitation[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select()
      .from(spaceInvitations)
      .where(
        and(
          eq(spaceInvitations.spaceId, spaceId),
          eq(spaceInvitations.status, "PENDING"),
          inArray(spaceInvitations.kind, ["EMAIL", "LINK"]),
          gt(spaceInvitations.expiresAt, now),
        ),
      )
      .orderBy(desc(spaceInvitations.createdAt), desc(spaceInvitations.id));
    const joins = await this.joinsOf(rows.map((r) => r.id));
    return rows.map((row) => toInvitation(row, joins.get(row.id) ?? []));
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
    await this.addJoins(invitation);
  }

  async revokePendingClaims(spaceId: SpaceId, guestMemberId: SpaceMemberId, revokedAt: Date): Promise<void> {
    await this.tm
      .executor()
      .update(spaceInvitations)
      .set({ status: "REVOKED", revokedAt })
      .where(
        and(
          eq(spaceInvitations.spaceId, spaceId),
          eq(spaceInvitations.guestMemberId, guestMemberId),
          eq(spaceInvitations.status, "PENDING"),
        ),
      );
  }

  /** #218: records the invitation's joins; a person already recorded keeps their first row, so saving is idempotent. */
  private async addJoins(invitation: Invitation): Promise<void> {
    if (invitation.joins.length === 0) return;
    await this.tm
      .executor()
      .insert(spaceInvitationUses)
      .values(
        invitation.joins.map((j) => ({
          invitationId: invitation.id,
          userId: j.userId,
          joinedAt: j.joinedAt,
        })),
      )
      .onConflictDoNothing();
  }

  private async withJoins(row: typeof spaceInvitations.$inferSelect | undefined): Promise<Invitation | null> {
    if (!row) return null;
    return toInvitation(row, (await this.joinsOf([row.id])).get(row.id) ?? []);
  }

  /** The joins of each invitation, oldest first (then by user id, so the order is total). */
  private async joinsOf(invitationIds: readonly string[]): Promise<Map<string, InvitationJoin[]>> {
    const joins = new Map<string, InvitationJoin[]>();
    if (invitationIds.length === 0) return joins;
    const rows = await this.tm
      .executor()
      .select()
      .from(spaceInvitationUses)
      .where(inArray(spaceInvitationUses.invitationId, [...invitationIds]))
      .orderBy(asc(spaceInvitationUses.joinedAt), asc(spaceInvitationUses.userId));
    for (const row of rows) {
      const list = joins.get(row.invitationId) ?? [];
      list.push({ userId: row.userId, joinedAt: row.joinedAt });
      joins.set(row.invitationId, list);
    }
    return joins;
  }
}
