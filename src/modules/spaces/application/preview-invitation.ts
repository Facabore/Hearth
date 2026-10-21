import { domainError, err, ok, type Result } from "@/shared/kernel";
import {
  effectiveStatus,
  isClaim,
  type InvitableRole,
  type Invitation,
  type InvitationStatus,
} from "../domain/invitation";
import type { SpaceMember } from "../domain/space";
import type { InvitationsDeps } from "./invitation-ports";

/** Ruling P156: what a visitor may read of an invitation they hold the token of; never its email or ids. */
export interface InvitationPreview {
  readonly kind: "EMAIL" | "LINK";
  readonly spaceName: string;
  readonly role: InvitableRole;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  /** The inviter's display name in the space; null once they left it. */
  readonly invitedBy: string | null;
}

/** Ruling P156: what a visitor may read of a claim link: whose place it hands over. */
export interface ClaimPreview {
  readonly spaceName: string;
  /** Null once the guest was removed (their links are revoked then, HU-E1-12). */
  readonly guestName: string | null;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly invitedBy: string | null;
}

export type PreviewDeps = Pick<InvitationsDeps, "invitations" | "tokens" | "members" | "spaces" | "clock">;
export type PreviewInvitation = (input: { token: string }) => Promise<Result<InvitationPreview>>;
export type PreviewClaim = (input: { token: string }) => Promise<Result<ClaimPreview>>;

const nameOf = (members: readonly SpaceMember[], find: (m: SpaceMember) => boolean): string | null =>
  members.find(find)?.displayName ?? null;

/** The invitation of `token` when it is of the wanted kind; both kinds share one store, so the kind keeps them apart. */
const found = async (
  deps: PreviewDeps,
  token: string,
  claim: boolean,
): Promise<Result<{ invitation: Invitation; members: SpaceMember[]; spaceName: string }>> => {
  const invitation = await deps.invitations.findByTokenHash(deps.tokens.hash(token));
  if (!invitation || isClaim(invitation) !== claim) return err(domainError("InvitationNotFound"));
  const [members, spaceName] = await Promise.all([
    deps.members.listCurrent(invitation.spaceId),
    deps.spaces.spaceNameOf(invitation.spaceId),
  ]);
  return ok({ invitation, members, spaceName });
};

/** HU-E9-05, ruling P156: GET /api/v1/invitations/{token}, public: the token is the authorization (HU-E1-06). */
export const createPreviewInvitation =
  (deps: PreviewDeps): PreviewInvitation =>
  async ({ token }) => {
    const result = await found(deps, token, false);
    if (!result.ok) return result;
    const { invitation, members, spaceName } = result.value;
    return ok({
      kind: invitation.kind === "EMAIL" ? "EMAIL" : "LINK",
      spaceName,
      role: invitation.role,
      status: effectiveStatus(invitation, deps.clock.now()),
      expiresAt: invitation.expiresAt,
      invitedBy: nameOf(members, (m) => m.userId === invitation.createdBy),
    });
  };

/** HU-E9-05, ruling P156: GET /api/v1/claims/{token}, public like the invitation's preview. */
export const createPreviewClaim =
  (deps: PreviewDeps): PreviewClaim =>
  async ({ token }) => {
    const result = await found(deps, token, true);
    if (!result.ok) return result;
    const { invitation, members, spaceName } = result.value;
    return ok({
      spaceName,
      guestName: nameOf(members, (m) => m.id === invitation.guestMemberId && m.kind === "GUEST"),
      status: effectiveStatus(invitation, deps.clock.now()),
      expiresAt: invitation.expiresAt,
      invitedBy: nameOf(members, (m) => m.userId === invitation.createdBy),
    });
  };
