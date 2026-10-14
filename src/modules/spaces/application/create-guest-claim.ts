import { ok, type Result } from "@/shared/kernel";
import { issueClaim } from "../domain/invitation";
import type { CreatedInvitation } from "./create-invitation";
import type { ClaimsDeps } from "./invitation-ports";
import { toInvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export type CreateGuestClaim = (input: {
  spaceId: string;
  userId: string;
  memberId: string;
}) => Promise<Result<CreatedInvitation>>;

/**
 * HU-E1-11: an OWNER or ADMIN creates a claim link for a current guest: a single-use bearer link, valid
 * 7 days and not bound to the guest's contact email, so no email is sent. Allowed in direct spaces too,
 * since claiming adds no member.
 */
export const createCreateGuestClaim =
  (deps: ClaimsDeps): CreateGuestClaim =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const token = deps.tokens.issue();
      const now = deps.clock.now();
      // The domain refuses anyone who is not a current guest among this space's members.
      const claim = issueClaim({
        id: deps.ids.next<"Invitation">(),
        spaceId,
        guestMemberId: input.memberId,
        current: await deps.members.listCurrent(spaceId),
        tokenHash: token.hash,
        createdBy: input.userId,
        now,
      });
      if (!claim.ok) return claim;
      await deps.invitations.add(claim.value);
      return ok({
        invitation: toInvitationView(claim.value, now),
        url: deps.claimUrl(token.token),
        emailSent: false,
      });
    });
