import { asc, eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { ReferralCodeStore, ReferralStore, StoredReferral } from "../application";
import { referralCodes, referrals } from "./referrals.schema";

/**
 * D27: the codes and the referrals. Both writes are a single `INSERT … ON CONFLICT DO NOTHING` read back afterwards, so
 * two concurrent first reads keep one code and two concurrent claims keep one referrer, whichever committed first.
 */
export class DrizzleReferrals implements ReferralCodeStore, ReferralStore {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async codeOf(userId: string): Promise<string | null> {
    const [row] = await this.tm
      .executor()
      .select({ code: referralCodes.code })
      .from(referralCodes)
      .where(eq(referralCodes.userId, userId))
      .limit(1);
    return row?.code ?? null;
  }

  async ownerOf(code: string): Promise<string | null> {
    const [row] = await this.tm
      .executor()
      .select({ userId: referralCodes.userId })
      .from(referralCodes)
      .where(eq(referralCodes.code, code))
      .limit(1);
    return row?.userId ?? null;
  }

  async keep(userId: string, code: string, at: Date): Promise<string | null> {
    // Either conflict, the person's row or the code's, leaves the table as it was.
    const inserted = await this.tm
      .executor()
      .insert(referralCodes)
      .values({ userId, code, createdAt: at })
      .onConflictDoNothing()
      .returning({ code: referralCodes.code });
    return inserted[0]?.code ?? (await this.codeOf(userId));
  }

  async referrerOf(userId: string): Promise<string | null> {
    const [row] = await this.tm
      .executor()
      .select({ referrerId: referrals.referrerUserId })
      .from(referrals)
      .where(eq(referrals.referredUserId, userId))
      .limit(1);
    return row?.referrerId ?? null;
  }

  async add(referral: { referrerId: string; referredId: string; createdAt: Date }): Promise<string> {
    await this.tm
      .executor()
      .insert(referrals)
      .values({
        referredUserId: referral.referredId,
        referrerUserId: referral.referrerId,
        createdAt: referral.createdAt,
      })
      .onConflictDoNothing({ target: referrals.referredUserId });
    const stored = await this.referrerOf(referral.referredId);
    if (stored === null) throw new Error("a referral just written cannot be read back");
    return stored;
  }

  async referredBy(referrerId: string): Promise<StoredReferral[]> {
    return this.tm
      .executor()
      .select({ referredId: referrals.referredUserId, createdAt: referrals.createdAt })
      .from(referrals)
      .where(eq(referrals.referrerUserId, referrerId))
      .orderBy(asc(referrals.createdAt));
  }
}
