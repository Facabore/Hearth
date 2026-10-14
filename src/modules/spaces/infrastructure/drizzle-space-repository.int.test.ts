import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { Id } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { createPersonalSpace } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleSpaceRepository(new DrizzleTransactionManager(db));
const newUser = async () => {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
    id,
    "Ana",
    `${id}@example.com`,
  ]);
  return id;
};
const personal = (userId: string) =>
  createPersonalSpace({
    id: randomUUID() as Id<"Space">,
    memberId: randomUUID() as Id<"SpaceMember">,
    ownerUserId: userId,
    ownerName: "Ana",
    now: new Date(),
  });

afterAll(() => pool.end());

describe("DrizzleSpaceRepository", () => {
  it("persists a personal space and lists it for its owner", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    expect(await repo.hasPersonalSpace(userId)).toBe(true);
    expect(await repo.listForUser(userId)).toEqual([
      {
        id: space.id,
        name: "Personal",
        kind: "PERSONAL",
        currency: "COP",
        periodPolicy: { kind: "MONTHLY", day: 1 },
        role: "OWNER",
      },
    ]);
  });

  it("lists nothing and reports no personal space for a user without spaces", async () => {
    const userId = await newUser();
    expect(await repo.hasPersonalSpace(userId)).toBe(false);
    expect(await repo.listForUser(userId)).toEqual([]);
  });

  it("enforces one personal space per user in the database", async () => {
    const userId = await newUser();
    await repo.add(personal(userId));
    // Drizzle wraps the PostgreSQL error ("Failed query: …"), so the constraint is read from its cause.
    const failure: unknown = await repo.add(personal(userId)).catch((error: unknown) => error);
    expect((failure as { cause?: { constraint?: string } }).cause?.constraint).toBe(
      "spaces_personal_owner_user_id_unique",
    );
  });

  it("removes the user's personal space when the user is deleted", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM spaces WHERE id = $1", [space.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe("DrizzleSpaceRepository memberships and settings (HU-E1-03)", () => {
  it("finds the owner's membership with the space settings", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    expect(await repo.findMembership(space.id, userId)).toEqual({
      spaceId: space.id,
      name: "Personal",
      spaceKind: "PERSONAL",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      memberId: space.members[0]!.id,
      userId,
      role: "OWNER",
      archived: false,
    });
  });

  it("finds nothing for another user or a malformed id", async () => {
    const userId = await newUser();
    const other = await newUser();
    const space = personal(userId);
    await repo.add(space);
    expect(await repo.findMembership(space.id, other)).toBeNull();
    expect(await repo.findMembership("not-a-uuid", userId)).toBeNull();
  });

  it("finds the membership of an archived space, flagged, so reads still reach it (HU-E1-09)", async () => {
    const userId = await newUser();
    const other = await newUser();
    const space = personal(userId);
    await repo.add(space);
    await pool.query("UPDATE spaces SET archived_at = now() WHERE id = $1", [space.id]);
    expect(await repo.findMembership(space.id, userId)).toMatchObject({ spaceId: space.id, archived: true });
    // Archived spaces are no less private: a user who is not a member still finds nothing.
    expect(await repo.findMembership(space.id, other)).toBeNull();
  });

  it("updates name, currency and period policy", async () => {
    const userId = await newUser();
    const space = personal(userId);
    await repo.add(space);
    await repo.updateSettings(space.id, {
      name: "Casa",
      currency: "USD",
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 },
    });
    expect(await repo.findMembership(space.id, userId)).toMatchObject({
      name: "Casa",
      currency: "USD",
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 5, day2: 20 },
    });
  });
});
