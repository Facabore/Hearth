import type { Result } from "@/shared/kernel";

/** Issue #86: confirms an account's address from the token its verification link carries (Better Auth in production). */
export interface EmailVerifier {
  /** InvalidVerificationLink for a token that is malformed, expired, forged or names no account. */
  verifyEmail(token: string): Promise<Result<void>>;
}

export type VerifyEmail = (input: { readonly token: string }) => Promise<Result<void>>;

/** Issue #86: the SPA's /verify-email screen sends the link's token here; confirming twice is ok both times. */
export const createVerifyEmail =
  (verifier: EmailVerifier): VerifyEmail =>
  ({ token }) =>
    verifier.verifyEmail(token);
