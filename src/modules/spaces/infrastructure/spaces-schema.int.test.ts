import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";
import { guestMemberFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";

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

describe("space_invitations claim links (HU-E1-11)", () => {
  it("binds claim links, and only them, to one guest, and only as MEMBER", async () => {
    const ana = await userFixture(pool, "Ana");
    const space = await sharedSpaceFixture(db, ana.id);
    const pedro = await guestMemberFixture(
      pool,
      { userId: ana.id, spaceId: space.id, memberId: space.members[0]!.id },
      "Pedro",
    );
    const insert = (kind: string, role: string, guestMemberId: string | null) =>
      pool.query(
        `INSERT INTO space_invitations (id, space_id, kind, role, token_hash, status, created_by, created_at, expires_at, guest_member_id)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, now(), now() + interval '7 days', $7)`,
        [randomUUID(), space.id, kind, role, randomUUID(), ana.id, guestMemberId],
      );
    await expect(insert("CLAIM", "MEMBER", null)).rejects.toThrow(/space_invitations_claim_guest/);
    await expect(insert("LINK", "MEMBER", pedro)).rejects.toThrow(/space_invitations_claim_guest/);
    await expect(insert("CLAIM", "ADMIN", pedro)).rejects.toThrow(/space_invitations_claim_role/);
    await expect(insert("CLAIM", "MEMBER", pedro)).resolves.toBeDefined();
  });
});

describe("spaces direct pair key (HU-E1-13, D16)", () => {
  const insert = (kind: string, pairKey: string | null, archivedAt: Date | null = null) =>
    pool.query(
      `INSERT INTO spaces (id, name, kind, currency, period_policy, direct_pair_key, archived_at, created_at)
       VALUES ($1, 'Ana & Juan', $2, 'COP', '{"kind":"MONTHLY","day":1}', $3, $4, now())`,
      [randomUUID(), kind, pairKey, archivedAt],
    );

  it("keeps one active direct space per pair; archived ones and spaces without a pair never conflict", async () => {
    const pair = `${randomUUID()}:${randomUUID()}`;
    await expect(insert("DIRECT", pair, new Date())).resolves.toBeDefined();
    await expect(insert("DIRECT", pair)).resolves.toBeDefined();
    await expect(insert("DIRECT", pair)).rejects.toThrow(/spaces_direct_pair_uq/);
    await expect(insert("DIRECT", null)).resolves.toBeDefined();
    await expect(insert("DIRECT", null)).resolves.toBeDefined();
  });

  it("stores a pair key on direct spaces only", async () => {
    await expect(insert("SHARED", `${randomUUID()}:${randomUUID()}`)).rejects.toThrow(
      /spaces_direct_pair_kind/,
    );
  });
});
