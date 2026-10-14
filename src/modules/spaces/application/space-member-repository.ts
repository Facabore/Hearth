import type { SpaceId, SpaceKind, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";

/** Outcome of adding a member; the database decides races between concurrent additions. */
export type AddMemberOutcome = "added" | "alreadyMember" | "nameTaken";

export interface SpaceMemberRepository {
  /**
   * Current members (not left) in join order (joinedAt, then id); `[]` for malformed ids. With `lock`,
   * their rows stay locked until the surrounding transaction ends, so role changes run one at a time.
   */
  listCurrent(spaceId: SpaceId, options?: { readonly lock?: boolean }): Promise<SpaceMember[]>;
  /** Adds the member unless its user is already a current member or a current member has its name (any case). */
  addMember(spaceId: SpaceId, member: SpaceMember): Promise<AddMemberOutcome>;
  updateRole(spaceId: SpaceId, memberId: SpaceMemberId, role: SpaceRole): Promise<void>;
}

/** HU-E1-08, HU-E1-12: members leave or are removed by setting leftAt; their rows stay for history (D15). */
export interface MemberLifecycleRepository {
  /**
   * Sets leftAt on the current member of that kind; false when none matched (left, removed or claimed
   * meanwhile, or a malformed id), so the database decides races.
   */
  markLeft(
    spaceId: SpaceId,
    memberId: SpaceMemberId,
    kind: SpaceMember["kind"],
    leftAt: Date,
  ): Promise<boolean>;
}

/** Outcome of claiming a guest's place; the database decides races with removals, claims and joins. */
export type ClaimOutcome = "claimed" | "notAGuest" | "alreadyMember";

/** HU-E1-11: claiming rewrites the guest's own member row, so no money row changes (D15). */
export interface GuestClaimRepository {
  /** The kind of a space that exists (claim links and invitations reference it). */
  spaceKindOf(spaceId: SpaceId): Promise<SpaceKind>;
  /**
   * Turns the current guest `claimed.id` into the registered member `claimed` and sets claimedAt;
   * "notAGuest" when it was removed or claimed meanwhile, "alreadyMember" when its user is a current
   * member of the space already.
   */
  claimGuest(spaceId: SpaceId, claimed: SpaceMember, claimedAt: Date): Promise<ClaimOutcome>;
}
