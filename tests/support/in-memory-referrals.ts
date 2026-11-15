import type { AuthUser } from "@/shared/kernel";
import type { ReferralAccount, ReferralsDeps } from "@/modules/referrals/application";

export const REFERRALS_NOW = new Date("2026-11-14T15:00:00Z");
export const HOUR = 60 * 60 * 1000;

/**
 * D27: in-memory stores with the database's rules (one code per person, unique codes, one referrer per account), a
 * clock fixed at REFERRALS_NOW, and random parts drawn from `randoms` in order.
 */
export const referralsWorld = (randoms: string[] = ["7k2qx9mt", "a3b4c5d6", "e7f8g9hj"]) => {
  const codes = new Map<string, string>();
  const referrals = new Map<string, { referrerId: string; createdAt: Date }>();
  const accounts = new Map<string, ReferralAccount>();
  const pending = [...randoms];
  const deps: ReferralsDeps = {
    codes: {
      codeOf: async (userId) => codes.get(userId) ?? null,
      ownerOf: async (code) => [...codes].find(([, c]) => c === code)?.[0] ?? null,
      keep: async (userId, code) => {
        const held = codes.get(userId);
        if (held !== undefined) return held;
        if ([...codes.values()].includes(code)) return null;
        codes.set(userId, code);
        return code;
      },
    },
    referrals: {
      referrerOf: async (userId) => referrals.get(userId)?.referrerId ?? null,
      add: async ({ referrerId, referredId, createdAt }) => {
        if (!referrals.has(referredId)) referrals.set(referredId, { referrerId, createdAt });
        return referrals.get(referredId)!.referrerId;
      },
      referredBy: async (referrerId) =>
        [...referrals]
          .filter(([, r]) => r.referrerId === referrerId)
          .map(([referredId, r]) => ({ referredId, createdAt: r.createdAt })),
    },
    people: {
      accountsOf: async (ids) => ids.flatMap((id) => (accounts.has(id) ? [accounts.get(id)!] : [])),
    },
    random: { next: () => pending.shift() ?? "zzzzzzzz" },
    clock: { now: () => new Date(REFERRALS_NOW) },
    referralUrl: (code) => `https://hearth.test/r/${code}`,
  };
  /** An account named `name`, an hour old unless `createdAt` says otherwise. */
  const person = (
    id: string,
    name: string,
    createdAt = new Date(REFERRALS_NOW.getTime() - HOUR),
  ): AuthUser => {
    accounts.set(id, { id, name, createdAt, emailVerified: false });
    return { id, name, email: `${id}@example.com`, locale: "es", timezone: "America/Bogota" };
  };
  const verify = (id: string) => accounts.set(id, { ...accounts.get(id)!, emailVerified: true });
  return { deps, codes, referrals, person, verify };
};
