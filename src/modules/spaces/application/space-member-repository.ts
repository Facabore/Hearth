import type { SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";

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
