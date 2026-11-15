import type { Clock } from "@/shared/kernel";

/** D27: each person's one referral code. */
export interface ReferralCodeStore {
  codeOf(userId: string): Promise<string | null>;
  ownerOf(code: string): Promise<string | null>;
  /**
   * Stores `code` as the user's unless they hold one already, and answers the code the user holds after the write:
   * theirs from before (or from a concurrent first read), or `code`. Null when `code` is someone else's.
   */
  keep(userId: string, code: string, at: Date): Promise<string | null>;
}

export interface StoredReferral {
  readonly referredId: string;
  readonly createdAt: Date;
}

/** D27: who referred whom; at most one referrer per account, never itself. */
export interface ReferralStore {
  referrerOf(userId: string): Promise<string | null>;
  /**
   * Records `referrerId` as `referredId`'s referrer unless the account has one already, and answers the referrer the
   * account has after the write: `referrerId`, or the one a concurrent claim stored first.
   */
  add(referral: { referrerId: string; referredId: string; createdAt: Date }): Promise<string>;
  referredBy(referrerId: string): Promise<StoredReferral[]>;
}

/** What referrals read of an account; the identity module answers it, so referrals never import it. */
export interface ReferralAccount {
  readonly id: string;
  readonly name: string;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
}

export interface ReferralPeople {
  accountsOf(userIds: readonly string[]): Promise<ReferralAccount[]>;
}

/** REFERRAL_RANDOM_LENGTH characters of REFERRAL_ALPHABET, from a cryptographic source. */
export interface ReferralRandom {
  next(): string;
}

export interface ReferralsDeps {
  readonly codes: ReferralCodeStore;
  readonly referrals: ReferralStore;
  readonly people: ReferralPeople;
  readonly random: ReferralRandom;
  readonly clock: Clock;
  /** The link a code is shared as (`<origin>/r/<code>`). */
  readonly referralUrl: (code: string) => string;
}
