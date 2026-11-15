import { localDateIn, ok, type AuthUser, type LocalDate, type Result } from "@/shared/kernel";
import { firstNameOf, referralCodeOf } from "../domain/referral-code";
import type { ReferralsDeps } from "./ports";

export interface ReferralItem {
  readonly firstName: string;
  /** The day the account was created, in the referrer's zone. */
  readonly joinedOn: LocalDate;
  /** Whether it earns its point: the referred person confirmed their email. */
  readonly counts: boolean;
}

/** D27: never the referred person's email or id; points are counted here, never stored (D7). */
export interface MyReferrals {
  readonly code: string;
  readonly link: string;
  readonly points: number;
  readonly items: readonly ReferralItem[];
}

export type GetMyReferrals = (input: { user: AuthUser }) => Promise<Result<MyReferrals>>;

/** A collision of 8 random characters is all but impossible; a few tries only bound a broken generator. */
const ATTEMPTS = 5;

/** D27: the person's code, created the first time it is read. */
const codeFor = async (deps: ReferralsDeps, user: AuthUser): Promise<string> => {
  const stored = await deps.codes.codeOf(user.id);
  if (stored !== null) return stored;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const kept = await deps.codes.keep(
      user.id,
      referralCodeOf(user.name, deps.random.next()),
      deps.clock.now(),
    );
    if (kept !== null) return kept;
  }
  throw new Error("no free referral code after several attempts");
};

/** D27: GET /api/v1/me/referrals, the person's link, points and the people who joined with it, newest first. */
export const createGetMyReferrals =
  (deps: ReferralsDeps): GetMyReferrals =>
  async ({ user }) => {
    const code = await codeFor(deps, user);
    const referred = await deps.referrals.referredBy(user.id);
    const accounts = await deps.people.accountsOf(referred.map((r) => r.referredId));
    const items = accounts
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((account): ReferralItem => ({
        firstName: firstNameOf(account.name),
        joinedOn: localDateIn(account.createdAt, user.timezone),
        counts: account.emailVerified,
      }));
    return ok({
      code,
      link: deps.referralUrl(code),
      points: items.filter((item) => item.counts).length,
      items,
    });
  };
