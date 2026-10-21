import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { GET as previewInvitation } from "@/app/api/v1/invitations/[token]/route";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import {
  GET as listInvitations,
  POST as createInvitation,
} from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { EmailSender, InvitationEmail } from "@/modules/spaces/application";
import { call, problemOf, registerUser, startTestApp, uniqueEmail, type TestUser } from "../support/app";
import { inviteByLink, joinAs, newSharedSpace, tokenOf } from "../support/spaces";

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
const accept = (user: TestUser | undefined, token: string) =>
  call(acceptInvitation, "POST", `/api/v1/invitations/${token}/accept`, { user, params: { token } });
const emailInvitation = async (owner: TestUser, spaceId: string, email: string) => {
  const body = await (await invite(owner, spaceId, { kind: "EMAIL", email, role: "MEMBER" })).json();
  return { id: body.invitation.id as string, token: tokenOf(body.url) };
};
const statusOf = async (invitationId: string) =>
  (await app.pool.query("SELECT status FROM space_invitations WHERE id = $1", [invitationId])).rows[0].status;
const membersOf = async (user: TestUser, spaceId: string) => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return (
    (await response.json()) as {
      items: { userId: string | null; displayName: string; role: string | null }[];
    }
  ).items;
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

  it("exposes only the contract fields and never the raw token or its hash", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const body = await (
      await invite(ana, spaceId, { kind: "EMAIL", email: "juan@example.com", role: "MEMBER" })
    ).json();
    expect(Object.keys(body).sort()).toEqual(["emailSent", "invitation", "url"]);
    expect(Object.keys(body.invitation).sort()).toEqual([
      "createdAt",
      "email",
      "expiresAt",
      "id",
      "kind",
      "role",
      "spaceId",
      "status",
    ]);
    const token = tokenOf(body.url);
    const { rows } = await app.pool.query("SELECT token_hash FROM space_invitations WHERE id = $1", [
      body.invitation.id,
    ]);
    const withoutUrl = JSON.stringify({ ...body, url: undefined });
    expect(withoutUrl).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(rows[0].token_hash);
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

  it("does not let a MEMBER revoke an invitation", async () => {
    const ana = await registerUser("Ana");
    const marta = await registerUser("Marta");
    const spaceId = await newSharedSpace(ana);
    await joinAs(ana, spaceId, marta, "MEMBER");
    const { invitation } = await (await invite(ana, spaceId, { kind: "LINK", role: "VIEWER" })).json();
    expect(await problemOf(await revoke(marta, spaceId, invitation.id))).toEqual([403, "InsufficientRole"]);
  });

  it("refuses to revoke an email invitation that was already accepted", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    expect((await accept(juan, token)).status).toBe(200);
    expect(await problemOf(await revoke(ana, spaceId, id))).toEqual([409, "InvitationAlreadyUsed"]);
  });

  it("does not revoke another space's invitation through a space the caller owns", async () => {
    const ana = await registerUser("Ana");
    const bea = await registerUser("Bea");
    const juan = await registerUser("Juan");
    const spaceA = await newSharedSpace(ana);
    const spaceB = await newSharedSpace(bea, "Other home");
    const { id, token } = await emailInvitation(ana, spaceA, juan.email);
    expect(await problemOf(await revoke(bea, spaceB, id))).toEqual([404, "InvitationNotFound"]);
    expect(await statusOf(id)).toBe("PENDING");
    expect((await accept(juan, token)).status).toBe(200);
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
    await joinAs(ana, spaceId, marta, "MEMBER");
    expect(await problemOf(await invite(marta, spaceId, { kind: "LINK", role: "VIEWER" }))).toEqual([
      403,
      "InsufficientRole",
    ]);
  });

  it("rejects a malformed email", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    expect(
      await problemOf(await invite(ana, spaceId, { kind: "EMAIL", email: "not-an-email", role: "MEMBER" })),
    ).toEqual([422, "ValidationFailed"]);
  });

  it("lists the pending invitations to an OWNER and refuses a MEMBER (HU-E9-05, ruling P155)", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    await invite(ana, spaceId, { kind: "EMAIL", email: "marta@example.com", role: "MEMBER" });
    await invite(ana, spaceId, { kind: "LINK", role: "VIEWER" });
    const listed = await call(listInvitations, "GET", `/api/v1/spaces/${spaceId}/invitations`, {
      user: ana,
      params: { spaceId },
    });
    expect(listed.status).toBe(200);
    const { items } = (await listed.json()) as {
      items: { kind: string; role: string; email: string | null }[];
    };
    expect(items.map((i) => [i.kind, i.role, i.email])).toEqual([
      ["LINK", "VIEWER", null],
      ["EMAIL", "MEMBER", "marta@example.com"],
    ]);
    expect(JSON.stringify(items)).not.toMatch(/token|url/i);
    const luis = await registerUser("Luis");
    await joinAs(ana, spaceId, luis, "MEMBER");
    const refused = await call(listInvitations, "GET", `/api/v1/spaces/${spaceId}/invitations`, {
      user: luis,
      params: { spaceId },
    });
    expect(await problemOf(refused)).toEqual([403, "InsufficientRole"]);
  });
});

describe("preview an invitation (HU-E9-05, ruling P156)", () => {
  const preview = (token: string) =>
    call(previewInvitation, "GET", `/api/v1/invitations/${token}`, { params: { token } });

  it("previews an invitation without a session and never shows its email (HU-E9-05, ruling P156)", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const { token } = await emailInvitation(ana, spaceId, "juan@example.com");
    const response = await call(previewInvitation, "GET", `/api/v1/invitations/${token}`, {
      params: { token },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: "EMAIL",
      spaceName: "Household",
      role: "MEMBER",
      status: "PENDING",
      invitedBy: "Ana",
    });
    expect(Object.keys(body).sort()).toEqual([
      "expiresAt",
      "invitedBy",
      "kind",
      "role",
      "spaceName",
      "status",
    ]);
    expect(JSON.stringify(body)).not.toContain("juan@example.com");
    const unknown = await call(previewInvitation, "GET", "/api/v1/invitations/nope", {
      params: { token: "nope" },
    });
    expect(await problemOf(unknown)).toEqual([404, "InvitationNotFound"]);
  });

  it("answers 404 InvitationNotFound for malformed tokens too, with or without a session", async () => {
    const ana = await registerUser("Ana");
    const malformed = ["x", "../../etc/passwd", "a b", "%00", "ñandú", "0".repeat(64), "A".repeat(4096)];
    for (const token of malformed) {
      expect(await problemOf(await preview(token))).toEqual([404, "InvitationNotFound"]);
      const signedIn = await call(previewInvitation, "GET", "/api/v1/invitations/x", {
        user: ana,
        params: { token },
      });
      expect(await problemOf(signedIn)).toEqual([404, "InvitationNotFound"]);
    }
  });

  it("reports a revoked invitation by its status and still hides the email", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, "juan@example.com");
    expect((await revoke(ana, spaceId, id)).status).toBe(200);
    const response = await preview(token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: "REVOKED" });
    expect(JSON.stringify(body)).not.toMatch(/juan@example.com|token|spaceId|userId/i);
  });

  it("changes nothing and is not throttled: the invitation stays acceptable after many previews", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    for (let i = 0; i < 40; i++) expect((await preview(token)).status).toBe(200);
    expect(await statusOf(id)).toBe("PENDING");
    expect((await accept(juan, token)).status).toBe(200);
  });
});

describe("accept an invitation (HU-E1-07)", () => {
  it("makes the signed-in invitee a MEMBER with joinedAt set and marks the invitation ACCEPTED", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    const response = await accept(juan, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: spaceId,
      name: "Household",
      kind: "SHARED",
      role: "MEMBER",
    });
    expect(await membersOf(ana, spaceId)).toContainEqual(
      expect.objectContaining({
        userId: juan.userId,
        displayName: "Juan",
        role: "MEMBER",
        joinedAt: expect.any(String),
      }),
    );
    expect(await statusOf(id)).toBe("ACCEPTED");
  });

  it("lets a visitor sign up first and then accept with the token", async () => {
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const email = uniqueEmail("juan");
    const { id, token } = await emailInvitation(ana, spaceId, email);
    const juan = await registerUser("Juan", email);
    expect((await accept(juan, token)).status).toBe(200);
    expect(await membersOf(ana, spaceId)).toContainEqual(
      expect.objectContaining({ userId: juan.userId, role: "MEMBER" }),
    );
    expect(await statusOf(id)).toBe("ACCEPTED");
  });

  it("rejects an invitation created 8 days ago", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    await app.pool.query(
      "UPDATE space_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [id],
    );
    expect(await problemOf(await accept(juan, token))).toEqual([409, "InvitationExpired"]);
  });

  it("rejects another account for an email-bound invitation", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const luis = await registerUser("Luis");
    const spaceId = await newSharedSpace(ana);
    const { token } = await emailInvitation(ana, spaceId, juan.email);
    expect(await problemOf(await accept(luis, token))).toEqual([403, "InvitationEmailMismatch"]);
  });

  it("rejects a revoked invitation", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { id, token } = await emailInvitation(ana, spaceId, juan.email);
    expect((await revoke(ana, spaceId, id)).status).toBe(200);
    expect(await problemOf(await accept(juan, token))).toEqual([409, "InvitationRevoked"]);
  });

  it("cannot be replayed, not even by two concurrent requests (Review Focus 2)", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    const { token } = await emailInvitation(ana, spaceId, juan.email);
    const [first, second] = await Promise.all([accept(juan, token), accept(juan, token)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect((await loser.json()).code).toBe("InvitationAlreadyUsed");
    expect(await problemOf(await accept(juan, token))).toEqual([409, "InvitationAlreadyUsed"]);
    const { rows } = await app.pool.query(
      "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND user_id = $2",
      [spaceId, juan.userId],
    );
    expect(rows[0].n).toBe(1);
  });

  it("answers an unknown token with 404 and an anonymous caller with 401", async () => {
    const juan = await registerUser("Juan");
    expect(await problemOf(await accept(juan, "not-a-token"))).toEqual([404, "InvitationNotFound"]);
    expect(await problemOf(await accept(undefined, "not-a-token"))).toEqual([401, "Unauthenticated"]);
  });

  it("keeps a link invitation valid for several people and rejects a second join", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const luis = await registerUser("Luis");
    const spaceId = await newSharedSpace(ana);
    const token = await inviteByLink(ana, spaceId, "VIEWER");
    expect((await accept(juan, token)).status).toBe(200);
    expect((await accept(luis, token)).status).toBe(200);
    expect(await problemOf(await accept(juan, token))).toEqual([409, "AlreadyMember"]);
  });
});

describe("inviting an existing member (HU-E1-06)", () => {
  it("rejects the email of a current member", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    const spaceId = await newSharedSpace(ana);
    await joinAs(ana, spaceId, juan, "MEMBER");
    expect(
      await problemOf(await invite(ana, spaceId, { kind: "EMAIL", email: juan.email, role: "MEMBER" })),
    ).toEqual([409, "AlreadyMember"]);
  });
});
