import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { DrizzleUserProfiles } from "@/modules/identity/infrastructure/drizzle-user-profiles";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { someoneWaitsFor, until } from "../../../../tests/support/locks";
import { createGetMyReferrals, type ReferralsDeps } from "../application";
import { cryptoReferralRandom } from "./crypto-referral-random";
import { DrizzleReferrals } from "./drizzle-referrals";

const { db, pool } = testDatabase();
const store = new DrizzleReferrals(new DrizzleTransactionManager(db));
const profiles = new DrizzleUserProfiles(new DrizzleTransactionManager(db), "America/Bogota");
const NOW = new Date("2026-11-14T15:00:00Z");

afterAll(() => pool.end());

const deps = (now = NOW): ReferralsDeps => ({
  codes: store,
  referrals: store,
  people: profiles,
  random: cryptoReferralRandom,
  clock: new FixedClock(now),
  referralUrl: (code) => `https://hearth.test/r/${code}`,
});
const rowsReferring = async (userId: string) =>
  (await pool.query(`SELECT referrer_user_id FROM referrals WHERE referred_user_id = $1`, [userId])).rows;

describe("DrizzleReferrals codes (D27)", () => {
  it("creates one code per person on the first read and answers it afterwards", async () => {
    const ana = await userFixture(pool, "Ana");
    const user = { ...ana, locale: "es", timezone: "America/Bogota" };
    const mine = createGetMyReferrals(deps());
    const first = await mine({ user });
    const again = await mine({ user });
    expect(first.ok && again.ok && first.value.code === again.value.code).toBe(true);
    expect(first.ok && first.value.code).toMatch(/^ana-[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    const { rows } = await pool.query(`SELECT code FROM referral_codes WHERE user_id = $1`, [ana.id]);
    expect(rows).toHaveLength(1);
  });

  it("keeps the code a concurrent first read stored, and refuses a code someone else holds", async () => {
    const [ana, juan] = [await userFixture(pool, "Ana"), await userFixture(pool, "Juan")];
    const code = `ana-${cryptoReferralRandom.next()}`;
    const kept = await Promise.all([
      store.keep(ana.id, code, NOW),
      store.keep(ana.id, `ana-${cryptoReferralRandom.next()}`, NOW),
    ]);
    expect(kept[0]).toBe(kept[1]);
    expect(await store.keep(juan.id, kept[0]!, NOW)).toBeNull();
    expect(await store.codeOf(juan.id)).toBeNull();
    expect(await store.ownerOf(kept[0]!)).toBe(ana.id);
  });
});

describe("DrizzleReferrals referrals (D27)", () => {
  it("refuses a referral of oneself in the database too", async () => {
    const ana = await userFixture(pool, "Ana");
    await expect(pool.query(`INSERT INTO referrals VALUES ($1, $1, now())`, [ana.id])).rejects.toMatchObject({
      constraint: "referrals_not_self",
    });
  });

  it("keeps the referrer a concurrent claim committed first, and the later claim reads it back", async () => {
    const [fabian, roger, ana] = [
      await userFixture(pool, "Fabián"),
      await userFixture(pool, "Roger"),
      await userFixture(pool, "Ana"),
    ];
    const first = await pool.connect();
    try {
      await first.query("BEGIN");
      const pid = Number((await first.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      await first.query(`INSERT INTO referrals VALUES ($1, $2, now())`, [ana.id, fabian.id]);
      // The second claim's insert waits on the first's uncommitted key, then reads back the first's referrer.
      const second = store.add({ referrerId: roger.id, referredId: ana.id, createdAt: NOW });
      await until("the second claim to queue behind the first", () => someoneWaitsFor(pool, pid));
      await first.query("COMMIT");
      expect(await second).toBe(fabian.id);
    } finally {
      first.release();
    }
    expect(await rowsReferring(ana.id)).toEqual([{ referrer_user_id: fabian.id }]);
  });

  it("lists the referred people with their account's creation and email state", async () => {
    const [fabian, ana] = [await userFixture(pool, "Fabián"), await userFixture(pool, "Ana María")];
    await store.add({ referrerId: fabian.id, referredId: ana.id, createdAt: NOW });
    await pool.query(`UPDATE "user" SET email_verified = true WHERE id = $1`, [ana.id]);
    expect(await store.referredBy(fabian.id)).toEqual([{ referredId: ana.id, createdAt: NOW }]);
    const [account] = await profiles.accountsOf([ana.id, "nobody"]);
    expect(account).toMatchObject({ id: ana.id, name: "Ana María", emailVerified: true });
    expect(account!.createdAt).toBeInstanceOf(Date);
    expect(await profiles.accountsOf([])).toEqual([]);
  });
});
