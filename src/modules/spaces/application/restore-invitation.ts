import { domainError, err, ok, type Result } from "@/shared/kernel";
import { restoreInvitation } from "../domain/invitation";
import type { InvitationsDeps } from "./invitation-ports";
import { toInvitationView, type InvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export type RestoreInvitation = (input: {
  spaceId: string;
  userId: string;
  invitationId: string;
}) => Promise<Result<InvitationView>>;

/**
 * Ruling P274: Deshacer after a revoke. Whoever may revoke (OWNER or ADMIN) brings back an invitation revoked in the
 * last 30 seconds that has not expired and was not used; restoring twice changes nothing.
 */
export const createRestoreInvitation =
  (deps: Pick<InvitationsDeps, "access" | "invitations" | "clock" | "tm">): RestoreInvitation =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
      if (!manager.ok) return manager;
      // Locked, as a revoke is, so a restore never interleaves with a revoke or an acceptance of the same invitation.
      const invitation = await deps.invitations.findForUpdate(manager.value.spaceId, input.invitationId);
      if (!invitation) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      const restored = restoreInvitation(invitation, now);
      if (!restored.ok) return restored;
      if (restored.value !== invitation) await deps.invitations.save(restored.value);
      return ok(toInvitationView(restored.value, now));
    });
