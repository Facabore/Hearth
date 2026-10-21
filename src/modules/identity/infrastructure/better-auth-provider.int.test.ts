import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { createAuth, SESSION_TTL_SECONDS } from "./better-auth";
import { BetterAuthProvider } from "./better-auth-provider";

const { db, pool } = testDatabase();
const provider = new BetterAuthProvider(
  createAuth({
    db,
    secret: "test-secret-0123456789abcdef0123456789",
    baseURL: "http://localhost:3000",
    defaultTimeZone: "America/Bogota",
  }),
  db,
  "America/Bogota",
);

afterAll(() => pool.end());

describe("BetterAuthProvider.findUserIdByEmail (HU-E1-06)", () => {
  it("finds a registered user by email, ignoring case and surrounding spaces", async () => {
    const juan = await userFixture(pool, "Juan");
    expect(await provider.findUserIdByEmail(`  ${juan.email.toUpperCase()} `)).toBe(juan.id);
  });

  it("finds nobody for an unknown email", async () => {
    expect(await provider.findUserIdByEmail(`nobody-${randomUUID()}@example.com`)).toBeNull();
  });
});

describe("Session lifetime (ruling P150)", () => {
  it("keeps a new session for 15 days, in the cookie and in the stored session", async () => {
    expect(SESSION_TTL_SECONDS).toBe(15 * 24 * 60 * 60);
    const before = Date.now();
    const created = await provider.signUp({
      name: "Ana",
      email: `ana-${randomUUID()}@example.com`,
      password: "correct horse battery",
    });
    if (!created.ok) throw new Error(created.error.code);
    const cookie = created.value.cookies.find((c) => c.startsWith("hearth.session_token="));
    expect(cookie).toMatch(/Max-Age=1296000/);
    const { rows } = await db.execute<{ expires_at: Date }>(
      sql`SELECT expires_at FROM session WHERE user_id = ${created.value.user.id}`,
    );
    const expiresAt = new Date(rows[0]!.expires_at).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(SESSION_TTL_SECONDS * 1000 - 5_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(SESSION_TTL_SECONDS * 1000 + 5_000);
  });
});
