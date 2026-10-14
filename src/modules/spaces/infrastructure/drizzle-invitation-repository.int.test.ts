import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { SystemClock } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, type Result } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { guestMemberFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { createAcceptInvitation } from "../application/accept-invitation";
import { createClaimGuestPlace } from "../application/claim-guest-place";
import type { ClaimsDeps } from "../application/invitation-ports";
import type { ClaimLinkRepository } from "../application/invitation-repository";
import { createSpaceAccess } from "../application/space-access";
import {
  issueClaim,
  issueInvitation,
  markAccepted,
  type InvitationId,
  type InvitationTarget,
} from "../domain/invitation";
import type { Space, SpaceMemberId } from "../domain/space";
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

const codes = (results: Result<unknown>[]) => results.map((r) => (r.ok ? "ok" : r.error.code)).sort();

/**
 * Answers once `parties` callers arrived or `ms` passed. Callers that a row lock keeps apart never meet, so
 * the one that got through waits out `ms`; callers that nothing separates leave together.
 */
const rendezvous = (parties: number, ms: number) => {
  let arrived = 0;
  let release: () => void = () => undefined;
  const everyone = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async (): Promise<void> => {
    arrived += 1;
    if (arrived >= parties) release();
    await Promise.race([everyone, new Promise((resolve) => setTimeout(resolve, ms))]);
  };
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
    spaces,
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

  it("refuses to join a direct space and adds nobody (HU-E1-13, D16)", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana.id);
    const { token, invitation } = await invite(space, ana.id, { kind: "LINK" });
    // CreateInvitation never issues one for a direct space, so the kind is changed by hand to get such a row.
    await pool.query("UPDATE spaces SET kind = 'DIRECT' WHERE id = $1", [space.id]);
    const input = { token, userId: juan.id, userEmail: juan.email, userName: juan.name };
    expect(codes([await accept(input)])).toEqual(["DirectSpaceIsFull"]);
    expect(await membershipRows(space.id, juan.id)).toBe(0);
    expect(await repo.findForUpdate(space.id, invitation.id)).toMatchObject({ status: "PENDING" });
  });
});

describe("claim links in PostgreSQL (HU-E1-11, HU-E1-12)", () => {
  const links: ClaimLinkRepository = repo;
  const claimedAt = new Date("2026-10-14T13:00:00Z");
  const guestOf = (space: Space, ownerId: string, name: string) =>
    guestMemberFixture(pool, { userId: ownerId, spaceId: space.id, memberId: space.members[0]!.id }, name);
  const claimFor = async (space: Space, createdBy: string, guestMemberId: string) => {
    const { token, hash } = cryptoInvitationTokens.issue();
    const issued = issueClaim({
      id: randomUUID() as InvitationId,
      spaceId: space.id,
      guestMemberId,
      current: await spaces.listCurrent(space.id),
      tokenHash: hash,
      createdBy,
      now: new Date("2026-10-14T12:00:00Z"),
    });
    if (!issued.ok) throw new Error(issued.error.code);
    await repo.add(issued.value);
    return { token, claim: issued.value };
  };
  const rowOf = async (id: string) =>
    (await pool.query("SELECT status, revoked_at FROM space_invitations WHERE id = $1", [id])).rows[0];
  const claimWith = (members: ClaimsDeps["members"]) =>
    createClaimGuestPlace({
      access: createSpaceAccess(spaces),
      members,
      claims: spaces,
      invitations: repo,
      tokens: cryptoInvitationTokens,
      claimUrl: (t) => t,
      ids: new UuidV7IdGenerator(),
      // An hour after claimFor issued the link, so it is valid whatever day the suite runs.
      clock: new FixedClock(claimedAt),
      tm,
    });
  /** The members of the space, read right after the claim link, each reader waiting there for `meet`. */
  const readingTogether = (meet: () => Promise<void>): ClaimsDeps["members"] => ({
    listCurrent: async (spaceId, options) => {
      const current = await spaces.listCurrent(spaceId, options);
      await meet();
      return current;
    },
  });
  /** What the claim touched: the guest's member row, how many member rows the space has, and the link. */
  const afterClaim = async (space: Space, guestId: string, linkId: string) => ({
    guest: (await pool.query("SELECT kind, user_id, claimed_at FROM space_members WHERE id = $1", [guestId]))
      .rows,
    memberRows: (
      await pool.query("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [space.id])
    ).rows[0].n,
    link: (
      await pool.query("SELECT status, accepted_by_user_id FROM space_invitations WHERE id = $1", [linkId])
    ).rows[0],
  });

  it("stores a claim link with its guest and finds it by its token hash", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const pedro = await guestOf(space, ana.id, "Pedro");
    const { token, claim } = await claimFor(space, ana.id, pedro);
    // Not null on both sides, or the round trip would prove nothing about the column.
    expect(claim.guestMemberId).toBe(pedro);
    expect(await repo.findByTokenHashForUpdate(cryptoInvitationTokens.hash(token))).toEqual(claim);
    expect(await repo.findForUpdate(space.id, claim.id)).toEqual(claim);
  });

  it("revokes only the pending claim links of the guest, and keeps every row", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const pedro = await guestOf(space, ana.id, "Pedro");
    const luis = await guestOf(space, ana.id, "Luis");
    const pending = await claimFor(space, ana.id, pedro);
    const used = await claimFor(space, ana.id, pedro);
    const revoked = await claimFor(space, ana.id, pedro);
    const earlier = new Date("2026-10-13T08:00:00Z");
    await repo.save(markAccepted(used.claim, ana.id, new Date()));
    await repo.save({ ...revoked.claim, status: "REVOKED", revokedAt: earlier });
    const other = await claimFor(space, ana.id, luis);
    const { invitation: link } = await invite(space, ana.id, { kind: "LINK" });
    const rows = "SELECT count(*)::int AS n FROM space_invitations WHERE space_id = $1";
    expect((await pool.query(rows, [space.id])).rows[0].n).toBe(5);
    const at = new Date("2026-10-15T12:00:00Z");
    await links.revokePendingClaims(space.id, pedro as SpaceMemberId, at);
    expect(await rowOf(pending.claim.id)).toEqual({ status: "REVOKED", revoked_at: at });
    expect(await rowOf(used.claim.id)).toEqual({ status: "ACCEPTED", revoked_at: null });
    expect(await rowOf(revoked.claim.id)).toEqual({ status: "REVOKED", revoked_at: earlier });
    expect(await rowOf(other.claim.id)).toEqual({ status: "PENDING", revoked_at: null });
    expect(await rowOf(link.id)).toEqual({ status: "PENDING", revoked_at: null });
    expect((await pool.query(rows, [space.id])).rows[0].n).toBe(5);
  });

  it("leaves the claim links alone when asked about another space or another guest", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const elsewhere = await household(ana.id);
    const pedro = await guestOf(space, ana.id, "Pedro");
    const { claim } = await claimFor(space, ana.id, pedro);
    const at = new Date("2026-10-15T12:00:00Z");
    await links.revokePendingClaims(elsewhere.id, pedro as SpaceMemberId, at);
    await links.revokePendingClaims(space.id, randomUUID() as SpaceMemberId, at);
    expect(await rowOf(claim.id)).toEqual({ status: "PENDING", revoked_at: null });
  });

  it("lets exactly one of two simultaneous claims of one link through (Review Focus 5)", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const pedro = await guestOf(space, ana.id, "Pedro");
    const { token, claim: link } = await claimFor(space, ana.id, pedro);
    const claim = claimWith(spaces);
    const users = [await newUser("Pedro"), await newUser("Marta")];
    const results = await Promise.all(users.map((u) => claim({ token, userId: u.id })));
    // Two mechanisms stand behind this (the link's FOR UPDATE, and the conditional UPDATE of the member row),
    // so this pins the outcome; the next test pins the lock.
    expect(codes(results)).toEqual(["GuestAlreadyClaimed", "ok"]);
    const winner = users[results.findIndex((r) => r.ok)]!;
    // The guest's own row was taken over, once: no second member row, and the link names its user.
    expect(await afterClaim(space, pedro, link.id)).toEqual({
      guest: [{ kind: "USER", user_id: winner.id, claimed_at: claimedAt }],
      memberRows: 2,
      link: { status: "ACCEPTED", accepted_by_user_id: winner.id },
    });
  });

  it("turns the second of two simultaneous claims away at the locked link, not at the member row", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana.id);
    const pedro = await guestOf(space, ana.id, "Pedro");
    const { token, claim: link } = await claimFor(space, ana.id, pedro);
    const pedroUser = await newUser("Pedro");
    // Both claims read the members right after the link and wait for each other there. Behind the link's
    // FOR UPDATE only one gets that far; without it both do, and the second is refused by the member row
    // (AlreadyMember) instead of finding the link used (GuestAlreadyClaimed), as a sequential claim would.
    const claim = claimWith(readingTogether(rendezvous(2, 1_500)));
    const results = await Promise.all([
      claim({ token, userId: pedroUser.id }),
      claim({ token, userId: pedroUser.id }),
    ]);
    expect(codes(results)).toEqual(["GuestAlreadyClaimed", "ok"]);
    expect(await afterClaim(space, pedro, link.id)).toEqual({
      guest: [{ kind: "USER", user_id: pedroUser.id, claimed_at: claimedAt }],
      memberRows: 2,
      link: { status: "ACCEPTED", accepted_by_user_id: pedroUser.id },
    });
  });
});
