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
