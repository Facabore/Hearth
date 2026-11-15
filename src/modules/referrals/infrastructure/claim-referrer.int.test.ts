import { afterAll, describe, expect, it } from "vitest";
import { DrizzleUserProfiles } from "@/modules/identity/infrastructure/drizzle-user-profiles";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { createClaimReferrer, createGetMyReferrals, type ReferralsDeps } from "../application";
import { cryptoReferralRandom } from "./crypto-referral-random";
import { DrizzleReferrals } from "./drizzle-referrals";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const store = new DrizzleReferrals(tm);
const NOW = new Date("2026-11-14T15:00:00Z");
const deps: ReferralsDeps = {
  codes: store,
  referrals: store,
  people: new DrizzleUserProfiles(tm, "America/Bogota"),
  random: cryptoReferralRandom,
  clock: new FixedClock(NOW),
  referralUrl: (code) => `https://hearth.test/r/${code}`,
};

afterAll(() => pool.end());

const asUser = (u: { id: string; name: string; email: string }) => ({
  ...u,
  locale: "es",
  timezone: "America/Bogota",
});

describe("concurrent claims (D27)", () => {
  it("stores one row when the same account claims two codes at once, and one claim is AlreadyReferred", async () => {
    const [fabian, roger, ana] = [
      await userFixture(pool, "Fabián"),
      await userFixture(pool, "Roger"),
      await userFixture(pool, "Ana"),
    ];
    const mine = createGetMyReferrals(deps);
    const codeOf = async (u: { id: string; name: string; email: string }) => {
      const result = await mine({ user: asUser(u) });
      if (!result.ok) throw new Error(result.error.code);
      return result.value.code;
    };
    // An account an hour old at NOW, so the claim is inside its 24 hours whatever the wall clock says.
    await pool.query(`UPDATE "user" SET created_at = $2 WHERE id = $1`, [
      ana.id,
      new Date(NOW.getTime() - 3_600_000),
    ]);
    const [first, second] = [await codeOf(fabian), await codeOf(roger)];
    const claim = createClaimReferrer(deps);
    const outcomes = await Promise.all([
      claim({ user: asUser(ana), code: first }),
      claim({ user: asUser(ana), code: second }),
    ]);
    expect(outcomes.map((o) => (o.ok ? "ok" : o.error.code)).toSorted()).toEqual(["AlreadyReferred", "ok"]);
    const { rows } = await pool.query(`SELECT 1 FROM referrals WHERE referred_user_id = $1`, [ana.id]);
    expect(rows).toHaveLength(1);
  });
});
