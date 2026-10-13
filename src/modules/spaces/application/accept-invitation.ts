import { domainError, err, map, type Result } from "@/shared/kernel";
import { ensureAcceptable, markAccepted } from "../domain/invitation";
import { userMember } from "../domain/member";
import type { SpaceMember } from "../domain/space";
import type { InvitationsDeps } from "./invitation-ports";
import { toSpaceSummary } from "./space-access";
import type { AddMemberOutcome } from "./space-member-repository";
import type { SpaceSummary } from "./space-repository";

export interface AcceptInvitationInput {
  readonly token: string;
  readonly userId: string;
  /** The signed-in user's email, compared with an email-bound invitation. */
  readonly userEmail: string;
  /** The signed-in user's name, used as display name in the space. */
  readonly userName: string;
}

export type AcceptInvitation = (input: AcceptInvitationInput) => Promise<Result<SpaceSummary>>;

/** Concurrent joins may take the computed display name; re-read and retry this many times in total. */
const MAX_JOIN_ATTEMPTS = 3;

/** HU-E1-07: a signed-in user joins the invitation's space with the invited role. */
export const createAcceptInvitation =
  (
    deps: Pick<InvitationsDeps, "access" | "members" | "invitations" | "tokens" | "ids" | "clock" | "tm">,
  ): AcceptInvitation =>
  (input) =>
    deps.tm.run(async () => {
      // Locked: concurrent acceptances of one invitation run one at a time (single-use email invitations).
      const invitation = await deps.invitations.findByTokenHashForUpdate(deps.tokens.hash(input.token));
      if (!invitation) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      const acceptable = ensureAcceptable(invitation, { email: input.userEmail, now });
      if (!acceptable.ok) return acceptable;
      const id = deps.ids.next<"SpaceMember">();
      // Names the database refused; lower() may fold letters differently from JavaScript, so never retry one.
      const refused: string[] = [];
      let outcome: AddMemberOutcome = "nameTaken";
      for (let attempt = 0; attempt < MAX_JOIN_ATTEMPTS && outcome === "nameTaken"; attempt += 1) {
        const current: SpaceMember[] = await deps.members.listCurrent(invitation.spaceId);
        if (current.some((m) => m.userId === input.userId)) return err(domainError("AlreadyMember"));
        const member: SpaceMember = userMember({
          id,
          userId: input.userId,
          userName: input.userName,
          role: invitation.role,
          now,
          current,
          alsoTaken: refused,
        });
        outcome = await deps.members.addMember(invitation.spaceId, member);
        if (outcome === "nameTaken") refused.push(member.displayName);
      }
      if (outcome === "alreadyMember") return err(domainError("AlreadyMember"));
      if (outcome === "nameTaken") return err(domainError("MemberNameTaken"));
      const accepted = markAccepted(invitation, input.userId, now);
      if (accepted !== invitation) await deps.invitations.save(accepted);
      return map(await deps.access(invitation.spaceId, input.userId), toSpaceSummary);
    });
