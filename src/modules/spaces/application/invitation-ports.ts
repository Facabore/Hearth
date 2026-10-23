import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { InvitationRepository } from "./invitation-repository";
import type { SpaceAccess } from "./space-access";
import type { GuestClaimRepository, SpaceMemberRepository } from "./space-member-repository";

/** A bearer token and the hash that is stored instead of it (HU-E1-06). */
export interface IssuedToken {
  readonly token: string;
  readonly hash: string;
}

export interface InvitationTokens {
  /** A URL-safe token with at least 128 bits of randomness, and its hash. */
  issue(): IssuedToken;
  hash(token: string): string;
}

export interface InvitationEmail {
  readonly to: string;
  readonly spaceName: string;
  readonly url: string;
}

/** HU-E1-06 `EmailSender`: sends invitation emails; resolves false when delivery is disabled or failed. */
export interface EmailSender {
  send(email: InvitationEmail): Promise<boolean>;
}

/** Registered users by email; bound to the identity module by the composition root. */
export interface RegisteredUsers {
  idByEmail(email: string): Promise<string | null>;
}

export interface InvitationsDeps {
  readonly access: SpaceAccess;
  readonly members: SpaceMemberRepository;
  /** AcceptInvitation refuses spaces that cannot gain members (their kind); previews show their name (P156). */
  readonly spaces: Pick<GuestClaimRepository, "spaceKindOf" | "spaceNameOf">;
  readonly invitations: InvitationRepository;
  readonly tokens: InvitationTokens;
  readonly emailSender: EmailSender;
  readonly users: RegisteredUsers;
  /** The web URL that carries only the token (HU-E1-06), e.g. https://hearth.example/invitations/<token>. */
  readonly invitationUrl: (token: string) => string;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}

/** HU-E1-11: claim links reuse the invitation store and tokens; claiming takes over the guest's row. */
export interface ClaimsDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly claims: GuestClaimRepository;
  readonly invitations: InvitationRepository;
  readonly tokens: InvitationTokens;
  /** The web URL that carries only the token, e.g. https://hearth.example/claims/<token>. */
  readonly claimUrl: (token: string) => string;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
