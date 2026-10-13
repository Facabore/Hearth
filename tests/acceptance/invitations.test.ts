import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { EmailSender, InvitationEmail } from "@/modules/spaces/application";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { newSharedSpace, tokenOf } from "../support/spaces";

const mails: InvitationEmail[] = [];
const emailSender: EmailSender = {
  send: async (email) => {
    mails.push(email);
    return true;
  },
};
const DAY_MS = 24 * 60 * 60 * 1000;

let app: Container;
beforeAll(() => {
  app = startTestApp({ emailSender });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const invite = (user: TestUser, spaceId: string, body: unknown) =>
  call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
    user,
    params: { spaceId },
    body,
  });
const revoke = (user: TestUser, spaceId: string, invitationId: string) =>
  call(revokeInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations/${invitationId}/revoke`, {
    user,
    params: { spaceId, invitationId },
  });

/** Makes `user` a current member of the space until invitation acceptance (HU-E1-07) can be driven over HTTP. */
const joinAs = async (
  user: TestUser,
  spaceId: string,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<string> => {
  const { rows } = await app.pool.query('SELECT name, email FROM "user" WHERE id = $1', [user.userId]);
  await app.pool.query(
    "INSERT INTO space_members (id, space_id, kind, user_id, display_name, role, joined_at) VALUES ($1, $2, 'USER', $3, $4, $5, now())",
    [randomUUID(), spaceId, user.userId, rows[0].name, role],
  );
  return rows[0].email;
};

describe("invitations (HU-E1-06)", () => {
  it("creates a pending email invitation that expires after 7 days and emails its link", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const response = await invite(ana, spaceId, { kind: "EMAIL", email: "Juan@Example.com", role: "MEMBER" });
    expect(response.status).toBe(201);
    const { invitation, url, emailSent } = await response.json();
    expect(invitation).toMatchObject({
      spaceId,
      kind: "EMAIL",
      email: "juan@example.com",
      role: "MEMBER",
      status: "PENDING",
    });
    expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)).toBe(7 * DAY_MS);
    expect(emailSent).toBe(true);
    expect(mails.at(-1)).toEqual({ to: "juan@example.com", spaceName: "Household", url });
  });

  it("creates a link invitation whose URL carries only an unguessable token, stored hashed", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const first = await (await invite(ana, spaceId, { kind: "LINK", role: "MEMBER" })).json();
    const second = await (await invite(ana, spaceId, { kind: "LINK", role: "MEMBER" })).json();
    expect(first.invitation).toMatchObject({ kind: "LINK", email: null, status: "PENDING" });
    expect(first.emailSent).toBe(false);
    const url = new URL(first.url);
    expect([url.origin, url.search, url.hash]).toEqual(["http://localhost:3000", "", ""]);
    expect(url.pathname).toMatch(/^\/invitations\/[A-Za-z0-9_-]{43}$/);
    expect(second.url).not.toBe(first.url);
    const { rows } = await app.pool.query("SELECT token_hash FROM space_invitations WHERE id = $1", [
      first.invitation.id,
    ]);
    expect(rows[0].token_hash).toBe(createHash("sha256").update(tokenOf(first.url)).digest("hex"));
  });

  it("never grants OWNER", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    expect(await problemOf(await invite(ana, spaceId, { kind: "LINK", role: "OWNER" }))).toEqual([
      422,
      "InvalidInvitationRole",
    ]);
  });

  it("refuses invitations to a personal space (HU-E1-02)", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await invite(ana, ana.spaceId, { kind: "LINK", role: "MEMBER" }))).toEqual([
      409,
      "PersonalSpaceNotShareable",
    ]);
  });

  it("hides the space from non-members", async () => {
    const ana = await registerUser("Ana");
    const marta = await registerUser("Marta");
    const spaceId = await newSharedSpace(ana);
    expect(await problemOf(await invite(marta, spaceId, { kind: "LINK", role: "MEMBER" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("revokes a pending invitation, and a second revocation changes nothing", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const { invitation } = await (
      await invite(ana, spaceId, { kind: "EMAIL", email: "juan@example.com", role: "MEMBER" })
    ).json();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await revoke(ana, spaceId, invitation.id);
      expect([response.status, (await response.json()).status]).toEqual([200, "REVOKED"]);
    }
  });

  it("answers unknown and malformed invitation ids with 404", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    for (const invitationId of [randomUUID(), "not-a-uuid"]) {
      expect(await problemOf(await revoke(ana, spaceId, invitationId))).toEqual([404, "InvitationNotFound"]);
    }
  });

  it("lets only an OWNER or ADMIN invite", async () => {
    const ana = await registerUser("Ana");
    const marta = await registerUser("Marta");
    const spaceId = await newSharedSpace(ana);
    await joinAs(marta, spaceId, "MEMBER");
    expect(await problemOf(await invite(marta, spaceId, { kind: "LINK", role: "VIEWER" }))).toEqual([
      403,
      "InsufficientRole",
    ]);
  });

  it("refuses an email invitation for someone who is already a member", async () => {
    const ana = await registerUser("Ana");
    const marta = await registerUser("Marta");
    const spaceId = await newSharedSpace(ana);
    const email = await joinAs(marta, spaceId, "MEMBER");
    expect(await problemOf(await invite(ana, spaceId, { kind: "EMAIL", email, role: "MEMBER" }))).toEqual([
      409,
      "AlreadyMember",
    ]);
  });

  it("rejects a malformed email", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    expect(
      await problemOf(await invite(ana, spaceId, { kind: "EMAIL", email: "not-an-email", role: "MEMBER" })),
    ).toEqual([422, "ValidationFailed"]);
  });
});
