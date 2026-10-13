import { domainError, err, ok, type Result } from "@/shared/kernel";
import { revokeInvitation } from "../domain/invitation";
import type { InvitationsDeps } from "./invitation-ports";
import { toInvitationView, type InvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export type RevokeInvitation = (input: {
  spaceId: string;
  userId: string;
  invitationId: string;
}) => Promise<Result<InvitationView>>;

/** HU-E1-06: OWNER or ADMIN revokes a pending invitation; revoking twice changes nothing. */
export const createRevokeInvitation =
  (deps: Pick<InvitationsDeps, "access" | "invitations" | "clock" | "tm">): RevokeInvitation =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
      if (!manager.ok) return manager;
      // Locked, so a revocation and a concurrent acceptance of the same invitation run one at a time.
      const invitation = await deps.invitations.findForUpdate(manager.value.spaceId, input.invitationId);
      if (!invitation) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      const revoked = revokeInvitation(invitation, now);
      if (!revoked.ok) return revoked;
      if (revoked.value !== invitation) await deps.invitations.save(revoked.value);
      return ok(toInvitationView(revoked.value, now));
    });
