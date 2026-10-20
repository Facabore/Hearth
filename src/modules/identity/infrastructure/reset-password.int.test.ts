import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, inject, it } from "vitest";
import { resetPassword } from "../../../../scripts/reset-password.mjs";
import { testDatabase } from "../../../../tests/support/database";
import { createAuth } from "./better-auth";
import { BetterAuthProvider } from "./better-auth-provider";

const { db, pool } = testDatabase();
const url = inject("databaseUrl");
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

const OLD = "old-password-123";
const NEW = "brand-new-pass-456";

/** A user signed up through Better Auth, who therefore holds one session. */
const registered = async () => {
  const email = `reset-${randomUUID()}@example.com`;
  const signedUp = await provider.signUp({ name: "Ana", email, password: OLD });
  if (!signedUp.ok) throw new Error("sign-up failed");
  return { email, id: signedUp.value.user.id };
};

const sessionCount = async (userId: string) =>
  Number(
    (await pool.query<{ n: string }>('SELECT count(*) AS n FROM "session" WHERE user_id = $1', [userId]))
      .rows[0]!.n,
  );

const storedHash = async (userId: string) =>
  (
    await pool.query<{ password: string | null }>(
      "SELECT password FROM account WHERE user_id = $1 AND provider_id = 'credential'",
      [userId],
    )
  ).rows[0]!.password;

describe("resetPassword (ruling P144)", () => {
  it("lets the person sign in with the new password only, and ends every one of their sessions", async () => {
    const ana = await registered();
    const other = await registered();
    await provider.signIn({ email: ana.email, password: OLD });
    await provider.signIn({ email: other.email, password: OLD });
    expect(await sessionCount(ana.id)).toBe(2);
    const otherSessions = await sessionCount(other.id);
    const otherHash = await storedHash(other.id);

    const result = await resetPassword(url, `  ${ana.email.toUpperCase()} `, NEW);

    expect(result).toEqual({ code: 0, message: `Password reset for ${ana.email}; 2 sessions ended.` });
    expect(await sessionCount(ana.id)).toBe(0);
    expect(await provider.signIn({ email: ana.email, password: OLD })).toMatchObject({
      ok: false,
      error: { code: "InvalidCredentials" },
    });
    expect(await provider.signIn({ email: ana.email, password: NEW })).toMatchObject({ ok: true });
    expect(await sessionCount(other.id)).toBe(otherSessions);
    expect(await storedHash(other.id)).toBe(otherHash);
  });

  it("answers code 3 for an unknown email and changes nothing", async () => {
    const ana = await registered();
    const hash = await storedHash(ana.id);
    const result = await resetPassword(url, `nobody-${randomUUID()}@example.com`, NEW);
    expect(result.code).toBe(3);
    expect(result.message).toMatch(/no user/i);
    expect(await storedHash(ana.id)).toBe(hash);
    expect(await sessionCount(ana.id)).toBe(1);
  });

  it("answers code 4 for a user without a password account and keeps their sessions", async () => {
    const id = randomUUID();
    const email = `${id}@example.com`;
    await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [id, "Social", email]);
    await pool.query(
      "INSERT INTO account (id, account_id, provider_id, user_id) VALUES ($1, $2, 'github', $3)",
      [randomUUID(), "gh-1", id],
    );
    await pool.query(
      "INSERT INTO session (id, expires_at, token, user_id) VALUES ($1, now() + interval '1 day', $2, $3)",
      [randomUUID(), randomUUID(), id],
    );
    const result = await resetPassword(url, email, NEW);
    expect(result.code).toBe(4);
    expect(result.message).toMatch(/no password/i);
    expect(await sessionCount(id)).toBe(1);
  });

  it.each([
    [7, "a".repeat(7)],
    [129, "a".repeat(129)],
  ])("answers code 5 for a password of %i characters and changes nothing", async (_length, password) => {
    const ana = await registered();
    const hash = await storedHash(ana.id);
    const result = await resetPassword(url, ana.email, password);
    expect(result.code).toBe(5);
    expect(result.message).toMatch(/8 and 128/);
    expect(await storedHash(ana.id)).toBe(hash);
    expect(await sessionCount(ana.id)).toBe(1);
  });

  it.each([
    [8, "a".repeat(8)],
    [128, "b".repeat(128)],
  ])("accepts a password of exactly %i characters", async (_length, password) => {
    const ana = await registered();
    expect((await resetPassword(url, ana.email, password)).code).toBe(0);
    expect(await provider.signIn({ email: ana.email, password })).toMatchObject({ ok: true });
  });
});

describe("scripts/reset-password.mjs as a command", () => {
  const cli = (args: string[], input: string) =>
    spawnSync(process.execPath, ["scripts/reset-password.mjs", ...args], {
      encoding: "utf8",
      input,
      env: { ...process.env, DATABASE_URL: url },
    });

  it("reads the password from stdin, strips only the line ending, and never echoes it", async () => {
    const ana = await registered();
    const password = "  spaced pass 789  ";
    const result = cli([ana.email], `${password}\r\nignored second line\n`);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`Password reset for ${ana.email}; 1 sessions ended.\n`);
    expect(result.stderr).toBe("");
    expect(await provider.signIn({ email: ana.email, password })).toMatchObject({ ok: true });
  });

  it.each([
    ["an unknown email", "unknown", "brand-new-pass-456\n", 3],
    ["a too short password", "known", "qz7k2m9\n", 5],
    ["no password on stdin", "known", "", 5],
  ])(
    "exits with the code of %s, with one stderr line free of the password",
    async (_name, who, input, code) => {
      const ana = await registered();
      const email = who === "known" ? ana.email : `nobody-${randomUUID()}@example.com`;
      const result = cli([email], input);
      expect(result.status).toBe(code);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      if (input.trim()) expect(result.stderr).not.toContain(input.trim());
    },
  );
});
