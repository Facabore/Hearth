import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { MemberInSpace } from "../application/direct-space-repository";
import type {
  AddMemberOutcome,
  ClaimOutcome,
  SpaceMemberRepository,
} from "../application/space-member-repository";
import type { SpaceRepository, SpaceSummary } from "../application/space-repository";
import type { MemberPlace, MemberPlaceRepository } from "../application/member-places";
import type {
  SpaceMembership,
  SpaceSettings,
  SpaceSettingsRepository,
} from "../application/space-settings-repository";
import type { Space, SpaceId, SpaceKind, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
import { directPairKey } from "../domain/direct-space";
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

/** One space row; the pair key is set only for a DIRECT space between two registered users (HU-E1-13). */
const spaceRow = (space: Space): typeof spaces.$inferInsert => ({
  id: space.id,
  name: space.name,
  kind: space.kind,
  currency: space.currency,
  periodPolicy: space.periodPolicy,
  personalOwnerUserId: space.personalOwnerUserId,
  directPairKey: directPairKey(space),
  createdAt: space.createdAt,
});

export class DrizzleSpaceRepository
  implements SpaceRepository, SpaceSettingsRepository, SpaceMemberRepository, MemberPlaceRepository
{
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(space: Space): Promise<void> {
    const db = this.tm.executor();
    await db.insert(spaces).values(spaceRow(space));
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

  async listForUser(
    userId: string,
    options: { readonly includeArchived?: boolean } = {},
  ): Promise<SpaceSummary[]> {
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
      .where(
        and(
          eq(spaceMembers.userId, userId),
          isNull(spaceMembers.leftAt),
          // HU-E1-09, the M1 archived=true convention: archived spaces only when asked for, beside the active ones.
          options.includeArchived === true ? undefined : isNull(spaces.archivedAt),
        ),
      )
      .orderBy(asc(spaces.createdAt));
  }

  async placesOf(userId: string): Promise<MemberPlace[]> {
    const rows = await this.tm
      .executor()
      .select({
        memberId: spaceMembers.id,
        spaceId: spaces.id,
        spaceName: spaces.name,
        spaceKind: spaces.kind,
        currency: spaces.currency,
        periodPolicy: spaces.periodPolicy,
      })
      .from(spaceMembers)
      .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
      // D15: left rows keep their history and a claim keeps the guest's row, so neither filters by leftAt or kind.
      .where(eq(spaceMembers.userId, userId))
      .orderBy(asc(spaces.createdAt), asc(spaceMembers.joinedAt), asc(spaceMembers.id));
    return rows.map((row) => ({
      ...row,
      memberId: row.memberId as SpaceMemberId,
      spaceId: row.spaceId as SpaceId,
    }));
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
        archivedAt: spaces.archivedAt,
      })
      .from(spaces)
      .innerJoin(spaceMembers, eq(spaceMembers.spaceId, spaces.id))
      // HU-E1-09: archived spaces are found and flagged; SpaceAccess lets only reads through.
      .where(and(eq(spaces.id, spaceId), eq(spaceMembers.userId, userId), isNull(spaceMembers.leftAt)))
      .limit(1);
    if (!row) return null;
    const { archivedAt, ...membership } = row;
    return {
      ...membership,
      spaceId: row.spaceId as SpaceId,
      memberId: row.memberId as SpaceMemberId,
      userId,
      archived: archivedAt !== null,
    };
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

  async markLeft(
    spaceId: SpaceId,
    memberId: SpaceMemberId,
    kind: SpaceMember["kind"],
    leftAt: Date,
  ): Promise<boolean> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(memberId)) return false;
    const left = await this.tm
      .executor()
      .update(spaceMembers)
      .set({ leftAt })
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.id, memberId),
          eq(spaceMembers.kind, kind),
          isNull(spaceMembers.leftAt),
        ),
      )
      .returning({ id: spaceMembers.id });
    return left.length > 0;
  }

  async spaceKindOf(spaceId: SpaceId): Promise<SpaceKind> {
    const [row] = await this.tm
      .executor()
      .select({ kind: spaces.kind })
      .from(spaces)
      .where(eq(spaces.id, spaceId));
    // Claim links reference their space (ON DELETE cascade), so a missing one is a broken invariant.
    if (!row) throw new Error(`space ${spaceId} does not exist`);
    return row.kind;
  }

  async claimGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome> {
    // A malformed id matches no row; it still gets the answers below, in the order every claim gets them.
    if (isUuid(claimed.id) && (await this.takeOverGuest(spaceId, claimed, claimedAt))) return "claimed";
    // ClaimGuestPlace refuses a current member before it looks at the guest, so that answer comes first here too.
    const current = await this.listCurrent(spaceId);
    return current.some((m) => m.userId === claimed.userId) ? "alreadyMember" : "notAGuest";
  }

  /** One conditional UPDATE, so the database decides races with removals, other claims and joins. */
  private async takeOverGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<boolean> {
    const taken = await this.tm
      .executor()
      .update(spaceMembers)
      .set({ kind: "USER", userId: claimed.userId, role: claimed.role, contactEmail: null, claimedAt })
      .where(
        and(
          eq(spaceMembers.spaceId, spaceId),
          eq(spaceMembers.id, claimed.id),
          // Still a current guest: not removed and not claimed meanwhile.
          eq(spaceMembers.kind, "GUEST"),
          isNull(spaceMembers.leftAt),
          // space_members_current_user_uq: the user is not a current member of the space yet.
          sql`NOT EXISTS (SELECT 1 FROM space_members c WHERE c.space_id = ${spaceId} AND c.user_id = ${claimed.userId} AND c.left_at IS NULL)`,
        ),
      )
      .returning({ id: spaceMembers.id });
    return taken.length > 0;
  }

  async findCurrentMember(memberId: string): Promise<MemberInSpace | null> {
    // Ids come from request bodies; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(memberId)) return null;
    const [row] = await this.tm
      .executor()
      .select({ spaceId: spaceMembers.spaceId, spaceKind: spaces.kind, ...memberColumns })
      .from(spaceMembers)
      .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
      .where(and(eq(spaceMembers.id, memberId), isNull(spaceMembers.leftAt)))
      .limit(1);
    if (!row) return null;
    const { spaceId, spaceKind, ...member } = row;
    return { spaceId: spaceId as SpaceId, spaceKind, member: { ...member, id: member.id as SpaceMemberId } };
  }

  async findByPairKey(pairKey: string): Promise<SpaceId | null> {
    const [row] = await this.tm
      .executor()
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.directPairKey, pairKey), isNull(spaces.archivedAt)))
      .limit(1);
    return row ? (row.id as SpaceId) : null;
  }

  async addDirect(space: Space): Promise<SpaceId> {
    const db = this.tm.executor();
    // No conflict target: spaces_direct_pair_uq counts, so the losing insert of two first splits waits
    // for the winner, then inserts nothing.
    const inserted = await db
      .insert(spaces)
      .values(spaceRow(space))
      .onConflictDoNothing()
      .returning({ id: spaces.id });
    if (inserted.length === 0) {
      const pairKey = directPairKey(space);
      const holder = pairKey === null ? null : await this.findByPairKey(pairKey);
      if (holder === null) throw new Error(`direct space ${space.id} conflicts with no active pair`);
      return holder;
    }
    await db.insert(spaceMembers).values(space.members.map((m) => memberRow(space.id, m)));
    return space.id;
  }

  /**
   * One conditional UPDATE. It answers false when an active space already holds the key; a first split that
   * inserts the key between the NOT EXISTS check and the update makes spaces_direct_pair_uq refuse the
   * update, so the claim fails (500): accepted for v1 (plan Self-Review assumption 5).
   */
  async adoptPairKey(spaceId: SpaceId, pairKey: string): Promise<boolean> {
    // Anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId)) return false;
    const adopted = await this.tm
      .executor()
      .update(spaces)
      .set({ directPairKey: pairKey })
      .where(
        and(
          eq(spaces.id, spaceId),
          // An active, unkeyed direct space: the key never moves and an archived space is not brought back.
          eq(spaces.kind, "DIRECT"),
          isNull(spaces.archivedAt),
          isNull(spaces.directPairKey),
          // spaces_direct_pair_uq counts active spaces only: an archived holder frees the pair, an active
          // one keeps it (D16: both are kept).
          sql`NOT EXISTS (SELECT 1 FROM spaces s WHERE s.direct_pair_key = ${pairKey} AND s.archived_at IS NULL)`,
        ),
      )
      .returning({ id: spaces.id });
    return adopted.length > 0;
  }

  async archive(spaceId: SpaceId, archivedAt: Date): Promise<void> {
    await this.tm
      .executor()
      .update(spaces)
      .set({ archivedAt })
      .where(and(eq(spaces.id, spaceId), isNull(spaces.archivedAt)));
  }
}
