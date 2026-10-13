import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";

const { db, pool } = testDatabase();

afterAll(() => pool.end());

describe("space_members shape checks (spec 5.2, D15, Review Focus 4)", () => {
  it("rejects guests with a user or a role and contact emails on registered members", async () => {
    const juan = await userFixture(pool, "Juan");
    const space = await sharedSpaceFixture(db, (await userFixture(pool, "Ana")).id);
    const insert = (kind: string, userId: string | null, role: string | null, contactEmail: string | null) =>
      pool.query(
        "INSERT INTO space_members (id, space_id, kind, user_id, display_name, role, contact_email, joined_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())",
        [randomUUID(), space.id, kind, userId, `Name ${randomUUID()}`, role, contactEmail],
      );
    await expect(insert("GUEST", null, "MEMBER", null)).rejects.toThrow(/space_members_guest_role/);
    await expect(insert("GUEST", juan.id, null, null)).rejects.toThrow(/space_members_guest_user/);
    await expect(insert("USER", juan.id, null, null)).rejects.toThrow(/space_members_guest_role/);
    await expect(insert("USER", juan.id, "MEMBER", "juan@example.com")).rejects.toThrow(
      /space_members_contact_email/,
    );
    await expect(insert("GUEST", null, null, "pedro@example.com")).resolves.toBeDefined();
  });
});
