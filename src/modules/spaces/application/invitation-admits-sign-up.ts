import { domainError, err } from "@/shared/kernel";
import { ensureAcceptable, ensureClaimable, isClaim } from "../domain/invitation";
import type { InvitationsDeps } from "./invitation-ports";

/** Ruling P143: whether `token` names a usable invitation for someone signing up with `email`. */
export type InvitationAdmitsSignUp = (input: { token: string; email: string }) => Promise<boolean>;

/**
 * Ruling P143: a closed installation is invite-only. An EMAIL or LINK invitation admits the sign-up when
 * AcceptInvitation would accept it for that address, and a CLAIM link when ClaimGuestPlace would; nothing is
 * accepted or changed here, and the caller never learns why a token was refused. The row is read through the same
 * locking finder as the accepting use cases, in a transaction that ends right after.
 */
export const createInvitationAdmitsSignUp =
  (deps: Pick<InvitationsDeps, "invitations" | "tokens" | "clock" | "tm">): InvitationAdmitsSignUp =>
  async ({ token, email }) => {
    const admitted = await deps.tm.run(async () => {
      const invitation = await deps.invitations.findByTokenHashForUpdate(deps.tokens.hash(token));
      if (!invitation) return err(domainError("InvitationNotFound"));
      const now = deps.clock.now();
      return isClaim(invitation)
        ? ensureClaimable(invitation, now)
        : ensureAcceptable(invitation, { email, now });
    });
    return admitted.ok;
  };
