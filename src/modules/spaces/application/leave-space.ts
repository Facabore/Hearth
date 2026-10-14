import { domainError, err, ok, type Result } from "@/shared/kernel";
import { ensureSettled, leavingMember, outstandingIn } from "../domain/member";
import { ensureMembersCanChange } from "../domain/space";
import type { LifecycleDeps } from "./lifecycle-deps";
import { authorizeSpaceAction } from "./space-access";

export type LeaveSpace = (input: { spaceId: string; userId: string }) => Promise<Result<void>>;

/**
 * HU-E1-08: a current member leaves a shared space once their balance is zero (a debt with a guest counts
 * too); the last OWNER stays. leftAt is set and the row stays, so history keeps the member (D15).
 */
export const createLeaveSpace =
  (deps: LifecycleDeps): LeaveSpace =>
  (input) =>
    deps.tm.run(async () => {
      const member = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.leave");
      if (!member.ok) return member;
      const { spaceId, memberId, spaceKind, currency } = member.value;
      const changeable = ensureMembersCanChange({ kind: spaceKind });
      if (!changeable.ok) return changeable;
      // Locked like role changes, so two owners leaving at once never leave the space without an OWNER.
      const leaver = leavingMember(await deps.members.listCurrent(spaceId, { lock: true }), memberId);
      if (!leaver.ok) return leaver;
      const settled = ensureSettled(outstandingIn([await deps.netBalance(spaceId, memberId)]), currency);
      if (!settled.ok) return settled;
      // false: the member is no longer current (a concurrent claim, removal or leave got there first), so a
      // leave that did not happen is never answered ok.
      const left = await deps.members.markLeft(spaceId, leaver.value.id, "USER", deps.clock.now());
      return left ? ok(undefined) : err(domainError("MemberNotFound"));
    });
