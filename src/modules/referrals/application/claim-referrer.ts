import { domainError, err, ok, type AuthUser, type Result } from "@/shared/kernel";
import { firstNameOf, parseReferralCode, withinReferralWindow } from "../domain/referral-code";
import type { ReferralsDeps } from "./ports";

export interface ReferralPreview {
  /** D27: all a link says of its owner. */
  readonly firstName: string;
}

export type PreviewReferral = (input: { code: string }) => Promise<Result<ReferralPreview>>;
export type ClaimReferrer = (input: { user: AuthUser; code: string }) => Promise<Result<void>>;

/** The owner of a well-formed, known code; a malformed code and an unknown one are the same ReferralCodeNotFound. */
const ownerOf = async (deps: Pick<ReferralsDeps, "codes">, raw: string): Promise<Result<string>> => {
  const code = parseReferralCode(raw);
  const owner = code === null ? null : await deps.codes.ownerOf(code);
  return owner === null ? err(domainError("ReferralCodeNotFound")) : ok(owner);
};

/** D27: GET /api/v1/referrals/{code}, public: the referrer's first name, nothing else. */
export const createPreviewReferral =
  (deps: Pick<ReferralsDeps, "codes" | "people">): PreviewReferral =>
  async ({ code }) => {
    const owner = await ownerOf(deps, code);
    if (!owner.ok) return owner;
    const [account] = await deps.people.accountsOf([owner.value]);
    return account ? ok({ firstName: firstNameOf(account.name) }) : err(domainError("ReferralCodeNotFound"));
  };

/**
 * D27: POST /api/v1/me/referrer. The caller becomes the code owner's referral when the code is not their own, they
 * have no referrer yet and their account is less than 24 hours old. The same claim again is ok; a claim that loses a
 * race to another code's is AlreadyReferred, since the store keeps one referrer per account.
 */
export const createClaimReferrer =
  (deps: ReferralsDeps): ClaimReferrer =>
  async ({ user, code }) => {
    const owner = await ownerOf(deps, code);
    if (!owner.ok) return owner;
    const referrerId = owner.value;
    if (referrerId === user.id) return err(domainError("OwnReferralCode"));
    const current = await deps.referrals.referrerOf(user.id);
    if (current !== null) return current === referrerId ? ok(undefined) : err(domainError("AlreadyReferred"));
    const now = deps.clock.now();
    const [account] = await deps.people.accountsOf([user.id]);
    if (!account || !withinReferralWindow(account.createdAt, now))
      return err(domainError("ReferralWindowClosed"));
    const stored = await deps.referrals.add({ referrerId, referredId: user.id, createdAt: now });
    return stored === referrerId ? ok(undefined) : err(domainError("AlreadyReferred"));
  };
