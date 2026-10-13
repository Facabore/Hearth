import { domainError, err, ok, type Result } from "@/shared/kernel";
import { issueInvitation, type InvitationTarget } from "../domain/invitation";
import { ensureCanAddMember, type SpaceRole } from "../domain/space";
import type { InvitationsDeps } from "./invitation-ports";
import { toInvitationView, type InvitationView } from "./invitation-view";
import { authorizeSpaceAction } from "./space-access";

export interface CreateInvitationInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly role: SpaceRole;
  readonly target: InvitationTarget;
}

export interface CreatedInvitation {
  readonly invitation: InvitationView;
  /** Carries only the token; shown once, since only its hash is stored. */
  readonly url: string;
  readonly emailSent: boolean;
}

export type CreateInvitation = (input: CreateInvitationInput) => Promise<Result<CreatedInvitation>>;

/** HU-E1-06: OWNER or ADMIN invites by email (bound to that address) or by shareable link. */
export const createCreateInvitation =
  (deps: InvitationsDeps): CreateInvitation =>
  async (input) => {
    const created = await deps.tm.run(async () => {
      const manager = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "member.invite");
      if (!manager.ok) return manager;
      const space = manager.value;
      const shareable = ensureCanAddMember({ kind: space.spaceKind });
      if (!shareable.ok) return shareable;
      const token = deps.tokens.issue();
      const invitation = issueInvitation({
        id: deps.ids.next<"Invitation">(),
        spaceId: space.spaceId,
        target: input.target,
        role: input.role,
        tokenHash: token.hash,
        createdBy: input.userId,
        now: deps.clock.now(),
      });
      if (!invitation.ok) return invitation;
      const { email } = invitation.value;
      if (email !== null) {
        const invitee = await deps.users.idByEmail(email);
        const current = await deps.members.listCurrent(space.spaceId);
        if (invitee !== null && current.some((m) => m.userId === invitee))
          return err(domainError("AlreadyMember"));
      }
      await deps.invitations.add(invitation.value);
      return ok({ invitation: invitation.value, token: token.token, spaceName: space.name });
    });
    if (!created.ok) return created;
    const { invitation, token, spaceName } = created.value;
    const url = deps.invitationUrl(token);
    // Sent after the commit, so a slow or failing mail server never holds or undoes the invitation.
    const emailSent =
      invitation.email === null
        ? false
        : await deps.emailSender.send({ to: invitation.email, spaceName, url }).catch(() => false);
    return ok({ invitation: toInvitationView(invitation, deps.clock.now()), url, emailSent });
  };
