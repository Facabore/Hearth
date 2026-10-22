import { ok, type Result } from "@/shared/kernel";
import type { InvitationsDeps } from "./invitation-ports";
import { toInvitationView, type InvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export type ListInvitations = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<InvitationView[]>>;

/** HU-E9-05, ruling P155: whoever may create and revoke invitations (OWNER, ADMIN) reads the pending ones. */
export const createListInvitations =
  (deps: Pick<InvitationsDeps, "access" | "invitations" | "clock">): ListInvitations =>
  async (input) => {
    const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
    if (!manager.ok) return manager;
    const now = deps.clock.now();
    const pending = await deps.invitations.listPending(manager.value.spaceId, now);
    return ok(pending.map((invitation) => toInvitationView(invitation, now)));
  };
