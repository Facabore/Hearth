import { domainError, err, type Result, type TransactionManager } from "@/shared/kernel";
import type { ArchiveSpace } from "./archive-space";
import type { SpaceAccess } from "./space-access";

export type RemoveFriend = (input: { spaceId: string; userId: string }) => Promise<Result<void>>;

/**
 * Ruling P339 (S7): a person removes a friend, one of their active direct spaces, only when the two are even: the space
 * is archived as HU-E1-09 archives one, so it leaves Amigos for both and every movement stays readable (D8). A balance
 * is FriendHasBalance; a space that is not direct is NotADirectSpace; one the person is not in, or already archived, is
 * SpaceNotFound.
 */
export const createRemoveFriend =
  (deps: {
    readonly access: SpaceAccess;
    readonly archiveSpace: ArchiveSpace;
    readonly tm: TransactionManager;
  }): RemoveFriend =>
  (input) =>
    deps.tm.run(async () => {
      // Membership first, so a non-member gets SpaceNotFound whatever the space is (spec 8).
      const viewer = await deps.access(input.spaceId, input.userId, { readOnly: true });
      if (!viewer.ok) return viewer;
      if (viewer.value.spaceKind !== "DIRECT") return err(domainError("NotADirectSpace"));
      if (viewer.value.archived) return err(domainError("SpaceNotFound"));
      // Both members of a direct space are its OWNERs (D16), so the archive's own checks pass; it takes the space's
      // lifecycle lock before it reads the nets (issue #89).
      const archived = await deps.archiveSpace(input);
      if (!archived.ok && archived.error.code === "OutstandingBalance") {
        return err(domainError("FriendHasBalance", archived.error.details));
      }
      return archived;
    });
