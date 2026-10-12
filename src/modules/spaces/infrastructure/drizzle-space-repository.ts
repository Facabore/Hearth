import { and, asc, eq, isNull } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { SpaceRepository, SpaceSummary } from "../application/space-repository";
import type { Space } from "../domain/space";
import { spaceMembers, spaces } from "./spaces.schema";

export class DrizzleSpaceRepository implements SpaceRepository {
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
}
