import { domainError, err, map, type Result } from "@/shared/kernel";
import { pairKeyOf } from "../domain/direct-space";
import { ensureClaimable, isClaim, markAccepted } from "../domain/invitation";
import { claimedGuest } from "../domain/member";
import type { ClaimsDeps } from "./invitation-ports";
import { toSpaceSummary } from "./space-access";
import type { SpaceSummary } from "./space-repository";

export type ClaimGuestPlace = (input: { token: string; userId: string }) => Promise<Result<SpaceSummary>>;

/**
 * HU-E1-11, D15: the signed-in user takes over the claim link's guest. The member keeps its id, so every
 * payment, share and settlement stays attached; it becomes registered (MEMBER, or OWNER in a direct
 * space, D16) and the link is used up.
 */
export const createClaimGuestPlace =
  (deps: ClaimsDeps): ClaimGuestPlace =>
  (input) =>
    deps.tm.run(async () => {
      // Locked: two uses of one link run one at a time (claim links are single-use).
      const claim = await deps.invitations.findByTokenHashForUpdate(deps.tokens.hash(input.token));
      // An invitation token is not a claim link: it never hands over a guest's place.
      if (!claim || !isClaim(claim)) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      const claimable = ensureClaimable(claim, now);
      if (!claimable.ok) return claimable;
      const current = await deps.members.listCurrent(claim.spaceId);
      if (current.some((m) => m.userId === input.userId)) return err(domainError("AlreadyMember"));
      const spaceKind = await deps.claims.spaceKindOf(claim.spaceId);
      // space_invitations_claim_guest: a CLAIM link always names its guest.
      const claimed = claimedGuest(current, claim.guestMemberId!, { userId: input.userId, spaceKind });
      if (!claimed.ok) return claimed;
      const outcome = await deps.claims.claimGuest(claim.spaceId, claimed.value, now);
      if (outcome === "alreadyMember") return err(domainError("AlreadyMember"));
      if (outcome === "notAGuest") return err(domainError("GuestAlreadyClaimed"));
      // D16: a guest's direct space that now holds two users becomes their pair's direct space, unless the
      // pair already has an active one (then both are kept; merging is deferred).
      const other = current.find((m) => m.id !== claimed.value.id);
      if (spaceKind === "DIRECT" && other?.userId) {
        await deps.claims.adoptPairKey(claim.spaceId, pairKeyOf(other.userId, input.userId));
      }
      await deps.invitations.save(markAccepted(claim, input.userId, now));
      return map(await deps.access(claim.spaceId, input.userId), toSpaceSummary);
    });
