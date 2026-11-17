import type { SpaceId, SpaceMemberId } from "../domain/space";

/** Outcome of renaming a guest; the database decides races with claims, removals and other names. */
export type RenameGuestOutcome = "renamed" | "nameTaken" | "notAGuest";

/** Ruling P338: the apodos a person gives the other member of their direct spaces. */
export interface FriendNameRepository {
  /** The alias the user keeps on their own current member row, by space; spaces without one are left out. */
  peerAliasesOf(userId: string): Promise<readonly { readonly spaceId: string; readonly alias: string }[]>;
  /** Stores `alias` (null clears it) on the viewer's own member row: only the viewer ever reads it. */
  setPeerAlias(spaceId: SpaceId, viewerMemberId: SpaceMemberId, alias: string | null): Promise<void>;
  /**
   * Gives the current guest `memberId` the name `name`; "nameTaken" when another current member has it (any case),
   * "notAGuest" when it was claimed or removed meanwhile.
   */
  renameGuest(spaceId: SpaceId, memberId: SpaceMemberId, name: string): Promise<RenameGuestOutcome>;
}
