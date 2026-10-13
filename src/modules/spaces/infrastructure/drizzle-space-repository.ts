import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { AddMemberOutcome, SpaceMemberRepository } from "../application/space-member-repository";
import type { SpaceRepository, SpaceSummary } from "../application/space-repository";
import type {
  SpaceMembership,
  SpaceSettings,
  SpaceSettingsRepository,
} from "../application/space-settings-repository";
import type { Space, SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
import { spaceMembers, spaces } from "./spaces.schema";

const memberRow = (spaceId: string, m: SpaceMember): typeof spaceMembers.$inferInsert => ({
  id: m.id,
  spaceId,
  kind: m.kind,
  userId: m.userId,
  displayName: m.displayName,
  role: m.role,
  contactEmail: m.contactEmail,
  joinedAt: m.joinedAt,
});

const memberColumns = {
  id: spaceMembers.id,
  kind: spaceMembers.kind,
  userId: spaceMembers.userId,
  displayName: spaceMembers.displayName,
  role: spaceMembers.role,
  contactEmail: spaceMembers.contactEmail,
  joinedAt: spaceMembers.joinedAt,
};

export class DrizzleSpaceRepository
  implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository
{
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(space: Space): Promise<void> {
    const db = this.tm.executor();
    await db.insert(spaces).values({
      id: space.id,
      name: space.name,
      kind: space.kind,
      currency: space.currency,
      periodPolicy: space.periodPolicy,
      personalOwnerUserId: space.personalOwnerUserId,
      createdAt: space.createdAt,
    });
    await db.insert(spaceMembers).values(space.members.map((m) => memberRow(space.id, m)));
  }

  async hasPersonalSpace(userId: string): Promise<boolean> {
    const rows = await this.tm
      .executor()
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.personalOwnerUserId, userId))
      .limit(1);
    return rows.length > 0;
  }

  async listForUser(userId: string): Promise<SpaceSummary[]> {
    return this.tm
      .executor()
      .select({
        id: spaces.id,
        name: spaces.name,
        kind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
        role: spaceMembers.role,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      .where(and(eq(spaceMembers.userId, userId), isNull(spaceMembers.leftAt), isNull(spaces.archivedAt)))
      .orderBy(asc(spaces.createdAt));
  }

  async findMembership(spaceId: string, userId: string): Promise<SpaceMembership | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId)) return null;
    const [row] = await this.tm
      .executor()
      .select({
        spaceId: spaces.id,
        name: spaces.name,
        spaceKind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
        memberId: spaceMembers.id,
        role: spaceMembers.role,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      .where(
        and(
          eq(spaces.id, spaceId),
          eq(spaceMembers.userId, userId),
          isNull(spaceMembers.leftAt),
          isNull(spaces.archivedAt),
        ),
      )
      .limit(1);
    return row
      ? { ...row, spaceId: row.spaceId as SpaceId, memberId: row.memberId as SpaceMemberId, userId }
      : null;
  }

  async updateSettings(spaceId: SpaceId, settings: SpaceSettings): Promise<void> {
    await this.tm
      .executor()
      .update(spaces)
      .set({ name: settings.name, currency: settings.currency, periodPolicy: settings.periodPolicy })
      .where(eq(spaces.id, spaceId));
  }

  async listCurrent(spaceId: SpaceId, options: { readonly lock?: boolean } = {}): Promise<SpaceMember[]> {
    if (!isUuid(spaceId)) return [];
    const query = this.tm
      .executor()
      .select(memberColumns)
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), isNull(spaceMembers.leftAt)))
      .orderBy(asc(spaceMembers.joinedAt), asc(spaceMembers.id));
    // Same rows in the same order for every locking reader of a space, so two role changes never deadlock.
    const rows = options.lock ? await query.for("update") : await query;
    return rows.map((row) => ({ ...row, id: row.id as SpaceMemberId }));
  }

  async addMember(spaceId: SpaceId, member: SpaceMember): Promise<AddMemberOutcome> {
    // No conflict target: both partial unique indexes (current user, current name) count, concurrent inserts included.
    const inserted = await this.tm
      .executor()
      .insert(spaceMembers)
      .values(memberRow(spaceId, member))
      .onConflictDoNothing()
      .returning({ id: spaceMembers.id });
    if (inserted.length > 0) return "added";
    if (member.userId === null) return "nameTaken";
    const current = await this.listCurrent(spaceId);
    return current.some((m) => m.userId === member.userId) ? "alreadyMember" : "nameTaken";
  }

  async updateRole(spaceId: SpaceId, memberId: SpaceMemberId, role: SpaceRole): Promise<void> {
    await this.tm
      .executor()
      .update(spaceMembers)
      .set({ role })
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.id, memberId)));
  }
}
