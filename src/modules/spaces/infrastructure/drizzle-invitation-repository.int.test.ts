import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { SystemClock } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import type { Result } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { createAcceptInvitation } from "../application/accept-invitation";
import { createSpaceAccess } from "../application/space-access";
import { issueInvitation, type InvitationId, type InvitationTarget } from "../domain/invitation";
import type { Space } from "../domain/space";
import { cryptoInvitationTokens } from "./crypto-invitation-tokens";
import { DrizzleInvitationRepository } from "./drizzle-invitation-repository";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const repo = new DrizzleInvitationRepository(tm);

const newUser = (name: string) => userFixture(pool, name);
const household = (ownerId: string) => sharedSpaceFixture(db, ownerId);
const invite = async (space: Space, createdBy: string, target: InvitationTarget, now = new Date()) => {
  const { token, hash } = cryptoInvitationTokens.issue();
  const invitation = issueInvitation({
    id: randomUUID() as InvitationId,
    spaceId: space.id,
    target,
    role: "MEMBER",
    tokenHash: hash,
    createdBy,
    now,
  });
  if (!invitation.ok) throw new Error(invitation.error.code);
  await repo.add(invitation.value);
  return { token, invitation: invitation.value };
};

afterAll(() => pool.end());

describe("DrizzleInvitationRepository (HU-E1-06, HU-E1-07)", () => {
  it("stores an invitation and finds it by space and id or by token hash", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const { token, invitation } = await invite(
      space,
      ana.id,
      { kind: "EMAIL", email: "juan@example.com" },
      new Date("2026-10-12T12:00:00Z"),
    );
    expect(await repo.findForUpdate(space.id, invitation.id)).toEqual(invitation);
    expect(await repo.findByTokenHashForUpdate(cryptoInvitationTokens.hash(token))).toEqual(invitation);
  });

  it("stores only the SHA-256 hash of the token", async () => {
    const ana = await newUser("Ana");
    const { token, invitation } = await invite(await household(ana.id), ana.id, { kind: "LINK" });
    const { rows } = await pool.query("SELECT token_hash FROM space_invitations WHERE id = $1", [
      invitation.id,
    ]);
    expect(rows[0].token_hash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("finds nothing for malformed ids, another space or an unknown hash", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const other = await household(ana.id);
    const { invitation } = await invite(space, ana.id, { kind: "LINK" });
    expect(await repo.findForUpdate("not-a-uuid", invitation.id)).toBeNull();
    expect(await repo.findForUpdate(space.id, "not-a-uuid")).toBeNull();
    expect(await repo.findForUpdate(other.id, invitation.id)).toBeNull();
    expect(await repo.findByTokenHashForUpdate("0".repeat(64))).toBeNull();
  });

  it("saves acceptance and revocation fields", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana.id);
    const { invitation } = await invite(space, ana.id, { kind: "EMAIL", email: juan.email });
    const accepted = {
      ...invitation,
      status: "ACCEPTED" as const,
      acceptedAt: new Date("2026-10-13T09:00:00Z"),
      acceptedByUserId: juan.id,
    };
    await repo.save(accepted);
    expect(await repo.findForUpdate(space.id, invitation.id)).toEqual(accepted);
  });

  it("rejects email invitations without an address and invitations granting OWNER", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const insert = (kind: string, email: string | null, role: string) =>
      pool.query(
        "INSERT INTO space_invitations (id, space_id, kind, email, role, token_hash, status, created_by, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, now(), now() + interval '7 days')",
        [randomUUID(), space.id, kind, email, role, randomUUID(), ana.id],
      );
    await expect(insert("EMAIL", null, "MEMBER")).rejects.toThrow(/space_invitations_email_kind/);
    await expect(insert("LINK", "juan@example.com", "MEMBER")).rejects.toThrow(
      /space_invitations_email_kind/,
    );
    await expect(insert("LINK", null, "OWNER")).rejects.toThrow(/space_invitations_role/);
  });
});

describe("AcceptInvitation against PostgreSQL (Review Focus 2)", () => {
  const accept = createAcceptInvitation({
    access: createSpaceAccess(spaces),
    members: spaces,
    invitations: repo,
    tokens: cryptoInvitationTokens,
    ids: new UuidV7IdGenerator(),
    clock: new SystemClock(),
    tm,
  });
  const membershipRows = async (spaceId: string, userId: string) =>
    (
      await pool.query("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND user_id = $2", [
        spaceId,
        userId,
      ])
    ).rows[0].n;
  const codes = (results: Result<unknown>[]) => results.map((r) => (r.ok ? "ok" : r.error.code)).sort();

  it("lets exactly one of two concurrent acceptances of an email invitation through", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana.id);
    const { token, invitation } = await invite(space, ana.id, { kind: "EMAIL", email: juan.email });
    const input = { token, userId: juan.id, userEmail: juan.email, userName: juan.name };
    expect(codes(await Promise.all([accept(input), accept(input)]))).toEqual(["InvitationAlreadyUsed", "ok"]);
    expect(await membershipRows(space.id, juan.id)).toBe(1);
    expect(await repo.findForUpdate(space.id, invitation.id)).toMatchObject({
      status: "ACCEPTED",
      acceptedByUserId: juan.id,
    });
  });

  it("adds a user once when they accept the same link twice at the same time", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana.id);
    const { token } = await invite(space, ana.id, { kind: "LINK" });
    const input = { token, userId: juan.id, userEmail: juan.email, userName: juan.name };
    expect(codes(await Promise.all([accept(input), accept(input)]))).toEqual(["AlreadyMember", "ok"]);
    expect(await membershipRows(space.id, juan.id)).toBe(1);
  });
});
