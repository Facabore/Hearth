import { domainError, err, ok, type Result } from "@/shared/kernel";
import { currentGuest, ensureSettled, outstandingIn } from "../domain/member";
import { ensureMembersCanChange } from "../domain/space";
import type { ClaimLinkRepository } from "./invitation-repository";
import type { LifecycleDeps } from "./lifecycle-deps";
import { authorizeSpaceAction } from "./space-access";

export type RemoveGuestMember = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
}) => Promise<Result<void>>;

export type RemoveGuestDeps = LifecycleDeps & { readonly invitations: ClaimLinkRepository };

/**
 * HU-E1-12, D15: MEMBER or above removes a guest whose balance is zero. Removal is soft (leftAt), so
 * history keeps the guest's name; the guest's pending claim links are revoked and the name is free again.
 */
export const createRemoveGuestMember =
  (deps: RemoveGuestDeps): RemoveGuestMember =>
  (input) =>
    deps.tm.run(async () => {
      const actor = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "guest.remove");
      if (!actor.ok) return actor;
      const { spaceId, spaceKind, currency } = actor.value;
      const changeable = ensureMembersCanChange({ kind: spaceKind });
      if (!changeable.ok) return changeable;
      // Issue #89: first lock of the transaction, before the guest's balance is read.
      await deps.spaceLocks.lockForLifecycle(spaceId);
      const guest = currentGuest(await deps.members.listCurrent(spaceId), input.memberId);
      if (!guest.ok) return guest;
      const settled = ensureSettled(
        outstandingIn([await deps.netBalance(spaceId, guest.value.id)]),
        currency,
      );
      if (!settled.ok) return settled;
      const now = deps.clock.now();
      // Claim links first, then the member row: ClaimGuestPlace takes them in the same order, so the two
      // never deadlock, and a claim that commits first leaves the conditional markLeft nothing to match.
      await deps.invitations.revokePendingClaims(spaceId, guest.value.id, now);
      if (!(await deps.members.markLeft(spaceId, guest.value.id, "GUEST", now))) {
        return err(domainError("NotAGuest"));
      }
      return ok(undefined);
    });
