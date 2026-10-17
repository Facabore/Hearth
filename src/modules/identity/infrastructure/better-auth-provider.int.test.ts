import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { userFixture } from "../../../../tests/support/fixtures";
import { createAuth } from "./better-auth";
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
