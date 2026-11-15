import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as claimReferrer } from "@/app/api/v1/me/referrer/route";
import { GET as myReferrals } from "@/app/api/v1/me/referrals/route";
import { GET as previewReferral } from "@/app/api/v1/referrals/[code]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, uniqueEmail, type TestUser } from "../support/app";

/** D27. The clock is fixed, and each account's creation is set against it, so no rule reads the wall clock. */
const NOW = new Date("2026-11-14T15:00:00Z");
const HOUR = 60 * 60 * 1000;

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(NOW) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const createdAgo = async (user: TestUser, ms: number) => {
  await app.pool.query(`UPDATE "user" SET created_at = $2 WHERE id = $1`, [
    user.userId,
    new Date(NOW.getTime() - ms),
  ]);
};
/** A person signed up an hour before NOW. */
const person = async (name: string) => {
  // The address from a plain word: a name with accents or spaces is no address.
  const user = await registerUser(name, uniqueEmail("person"));
  await createdAgo(user, HOUR);
  return user;
};
const mine = (user: TestUser) => call(myReferrals, "GET", "/api/v1/me/referrals", { user });
const codeOf = async (user: TestUser) => ((await (await mine(user)).json()) as { code: string }).code;
const preview = (code: string) =>
  call(previewReferral, "GET", `/api/v1/referrals/${encodeURIComponent(code)}`, { params: { code } });
const claim = (user: TestUser, code: string) =>
  call(claimReferrer, "POST", "/api/v1/me/referrer", { user, body: { code } });
const referrersOf = async (user: TestUser) =>
  (
    await app.pool.query(`SELECT referrer_user_id FROM referrals WHERE referred_user_id = $1`, [user.userId])
  ).rows.map((row: { referrer_user_id: string }) => row.referrer_user_id);
const verify = (user: TestUser) =>
  app.pool.query(`UPDATE "user" SET email_verified = true WHERE id = $1`, [user.userId]);

describe("a person's referral link (D27)", () => {
  it("is created on the first read and is the same afterwards, as /r/<code> on the app's origin", async () => {
    const fabian = await person("Fabián Bonilla");
    const first = await mine(fabian);
    expect(first.status).toBe(200);
    const body = (await first.json()) as { code: string; link: string; points: number; items: unknown[] };
    expect(body.code).toMatch(/^fabian-[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    expect(body).toEqual({
      code: body.code,
      link: `http://localhost:3000/r/${body.code}`,
      points: 0,
      items: [],
    });
    expect(await codeOf(fabian)).toBe(body.code);
  });

  it("needs a session", async () => {
    expect(await problemOf(await call(myReferrals, "GET", "/api/v1/me/referrals"))).toEqual([
      401,
      "Unauthenticated",
    ]);
    expect(
      await problemOf(await call(claimReferrer, "POST", "/api/v1/me/referrer", { body: { code: "x" } })),
    ).toEqual([401, "Unauthenticated"]);
  });
});

describe("a referral link's public preview (D27)", () => {
  it("answers only the referrer's first name, without a session", async () => {
    const fabian = await person("Fabián Bonilla");
    const response = await preview(await codeOf(fabian));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ firstName: "Fabián" });
  });

  it("answers the same 404 for an unknown code and a malformed one", async () => {
    const answers = await Promise.all(["nobody-23456789", "%2e%2e", "x".repeat(300)].map(preview));
    for (const answer of answers) expect(await problemOf(answer)).toEqual([404, "ReferralCodeNotFound"]);
  });
});

describe("claiming a referrer after sign-up (D27)", () => {
  it("leaves an account that signed up without a link with no referrer, as before", async () => {
    const ana = await person("Ana");
    expect(await referrersOf(ana)).toEqual([]);
    const { rows } = await app.pool.query(`SELECT 1 FROM referral_codes WHERE user_id = $1`, [ana.userId]);
    expect(rows).toEqual([]);
  });

  it("makes the code's owner the new account's referrer, and the same claim again is fine", async () => {
    const fabian = await person("Fabián");
    const code = await codeOf(fabian);
    const ana = await person("Ana");
    expect((await claim(ana, code)).status).toBe(204);
    expect((await claim(ana, code.toUpperCase())).status).toBe(204);
    expect(await referrersOf(ana)).toEqual([fabian.userId]);
  });

  it("refuses the person's own code with 409 OwnReferralCode", async () => {
    const fabian = await person("Fabián");
    expect(await problemOf(await claim(fabian, await codeOf(fabian)))).toEqual([409, "OwnReferralCode"]);
    expect(await referrersOf(fabian)).toEqual([]);
  });

  it("refuses an account created 24 hours ago or earlier with 409 ReferralWindowClosed", async () => {
    const code = await codeOf(await person("Fabián"));
    const luis = await registerUser("Luis");
    await createdAgo(luis, 24 * HOUR);
    expect(await problemOf(await claim(luis, code))).toEqual([409, "ReferralWindowClosed"]);
    expect(await referrersOf(luis)).toEqual([]);
  });

  it("refuses a second referrer with 409 AlreadyReferred and keeps the first", async () => {
    const fabian = await person("Fabián");
    const roger = await person("Roger");
    const ana = await person("Ana");
    await claim(ana, await codeOf(fabian));
    expect(await problemOf(await claim(ana, await codeOf(roger)))).toEqual([409, "AlreadyReferred"]);
    expect(await referrersOf(ana)).toEqual([fabian.userId]);
  });

  it("refuses an unknown code with 404 ReferralCodeNotFound and a body without a code with 422", async () => {
    const ana = await person("Ana");
    expect(await problemOf(await claim(ana, "nobody-23456789"))).toEqual([404, "ReferralCodeNotFound"]);
    expect(
      await problemOf(await call(claimReferrer, "POST", "/api/v1/me/referrer", { user: ana, body: {} })),
    ).toEqual([422, "ValidationFailed"]);
    expect(await referrersOf(ana)).toEqual([]);
  });
});

describe("the referrer's points and list (D27)", () => {
  it("counts a point only once the referred person confirmed their email, and never shows their email or id", async () => {
    const fabian = await person("Fabián");
    const code = await codeOf(fabian);
    const andres = await person("Andrés Gómez");
    const yuberley = await person("Yuberley");
    await claim(andres, code);
    await claim(yuberley, code);
    await verify(andres);
    const response = await mine(fabian);
    const text = await response.text();
    const body = JSON.parse(text) as { points: number; items: { firstName: string; counts: boolean }[] };
    expect(body.points).toBe(1);
    expect(
      body.items
        .map(({ firstName, counts }) => ({ firstName, counts }))
        .toSorted((a, b) => a.firstName.localeCompare(b.firstName)),
    ).toEqual([
      { firstName: "Andrés", counts: true },
      { firstName: "Yuberley", counts: false },
    ]);
    // The accounts were created an hour before NOW: 09:00 in Bogotá, the referrer's zone.
    expect(body.items.map((item) => (item as unknown as { joinedOn: string }).joinedOn)).toEqual([
      "2026-11-14",
      "2026-11-14",
    ]);
    for (const secret of [andres.email, andres.userId, yuberley.email, yuberley.userId])
      expect(text).not.toContain(secret);
  });
});
