import { domainError, err, ok, type Result, type TransactionManager } from "@/shared/kernel";
import { directPeer, friendName, friendNickname, guestNickname, type FriendName } from "../domain/friend";
import { ensureNameAvailable } from "../domain/member";
import type { SpaceId } from "../domain/space";
import type { FriendNameRepository } from "./friend-names";
import type { SpaceAccess } from "./space-access";
import type { SpaceLocks } from "./space-locks";
import type { SpaceMemberRepository } from "./space-member-repository";

/** Ruling P338: the other member of one of the viewer's direct spaces, by the name the viewer now gives them. */
export interface FriendNameView extends FriendName {
  readonly spaceId: SpaceId;
}

export type SetFriendNickname = (input: {
  spaceId: string;
  userId: string;
  nickname: string | null;
}) => Promise<Result<FriendNameView>>;

export interface SetFriendNicknameDeps {
  readonly access: SpaceAccess;
  readonly spaceLocks: Pick<SpaceLocks, "lockForLifecycle">;
  readonly members: Pick<SpaceMemberRepository, "listCurrent"> & FriendNameRepository;
  readonly tm: TransactionManager;
}

/**
 * Ruling P338: a person's apodo for whom they share a direct space with. For a registered person it is the viewer's
 * own alias, which nobody else sees; for a guest it is the guest's name, unique in the space like any member's.
 */
export const createSetFriendNickname =
  (deps: SetFriendNicknameDeps): SetFriendNickname =>
  (input) =>
    deps.tm.run(async () => {
      // Membership first, so a non-member gets SpaceNotFound whatever the space is (spec 8); an archived one refuses.
      const viewer = await deps.access(input.spaceId, input.userId);
      if (!viewer.ok) return viewer;
      const { spaceId, spaceKind, memberId } = viewer.value;
      if (spaceKind !== "DIRECT") return err(domainError("NotADirectSpace"));
      // Issue #89: the space row first, as every member change takes it, so member-row locks never form a cycle.
      await deps.spaceLocks.lockForLifecycle(spaceId);
      const current = await deps.members.listCurrent(spaceId);
      const other = directPeer(current, memberId);
      // D16: a direct space keeps its two members; one without the other is a broken invariant.
      if (!other) throw new Error(`direct space ${spaceId} has no second member`);
      if (other.kind === "USER") {
        const alias = friendNickname(input.nickname);
        if (!alias.ok) return alias;
        await deps.members.setPeerAlias(spaceId, memberId, alias.value);
        return ok({ spaceId, ...friendName(other, alias.value) });
      }
      const name = guestNickname(input.nickname);
      if (!name.ok) return name;
      const available = ensureNameAvailable(
        current.filter((member) => member.id !== other.id),
        name.value,
      );
      if (!available.ok) return available;
      // The database has the last word: a claim or a removal may have changed the guest meanwhile.
      const outcome = await deps.members.renameGuest(spaceId, other.id, name.value);
      if (outcome === "nameTaken") return err(domainError("MemberNameTaken"));
      if (outcome === "notAGuest") return err(domainError("NotAGuest"));
      return ok({ spaceId, ...friendName({ ...other, displayName: name.value }, null) });
    });
