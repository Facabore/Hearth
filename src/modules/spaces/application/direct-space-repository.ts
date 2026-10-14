import type { Space, SpaceId, SpaceKind, SpaceMember } from "../domain/space";

/** A current member of some space, with that space's kind (HU-E1-13 counterparts). */
export interface MemberInSpace {
  readonly spaceId: SpaceId;
  readonly spaceKind: SpaceKind;
  readonly member: SpaceMember;
}

/** HU-E1-13, D16: direct spaces, one active per pair of registered users. */
export interface DirectSpaceRepository {
  /** The current member with that id, in whatever space; null for unknown, former or malformed ids. */
  findCurrentMember(memberId: string): Promise<MemberInSpace | null>;
  /** The active (not archived) DIRECT space stored under the pair key, or null. */
  findByPairKey(pairKey: string): Promise<SpaceId | null>;
  /**
   * Adds the DIRECT space with its two members and its pair key; when an active space already holds the
   * key (a concurrent first split), adds nothing and returns that space's id. The database decides races.
   */
  addDirect(space: Space): Promise<SpaceId>;
}
