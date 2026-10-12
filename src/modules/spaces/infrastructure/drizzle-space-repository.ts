import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { SpaceRepository, SpaceSummary } from "../application/space-repository";
import type {
  SpaceMembership,
  SpaceSettings,
  SpaceSettingsRepository,
} from "../application/space-settings-repository";
import type { Space, SpaceId, SpaceMemberId } from "../domain/space";
import { spaceMembers, spaces } from "./spaces.schema";

export class DrizzleSpaceRepository implements SpaceRepository, SpaceSettingsRepository {
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
    await db.insert(spaceMembers).values(
      space.members.map((m) => ({
        id: m.id,
        spaceId: space.id,
        kind: m.kind,
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
    );
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
}
