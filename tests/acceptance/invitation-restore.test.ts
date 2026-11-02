import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { POST as restoreInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/restore/route";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import {
  POST as createInvitation,
  GET as listInvitations,
} from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { Clock } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { joinAs, newSharedSpace, tokenOf } from "../support/spaces";

/** A test clock moved by seconds, so the 30-second window of ruling P274 is crossed without waiting. */
class SteppedClock implements Clock {
  private instant = new Date("2026-11-02T15:00:00Z");
  now(): Date {
    return new Date(this.instant);
  }
  advance(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}

const clock = new SteppedClock();
let app: Container;
beforeAll(() => {
  app = startTestApp({ clock });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const pathOf = (spaceId: string, invitationId: string, action: string) =>
  `/api/v1/spaces/${spaceId}/invitations/${invitationId}/${action}`;
const revoke = (user: TestUser, spaceId: string, invitationId: string) =>
  call(revokeInvitation, "POST", pathOf(spaceId, invitationId, "revoke"), {
    user,
    params: { spaceId, invitationId },
  });
const restore = (user: TestUser, spaceId: string, invitationId: string) =>
  call(restoreInvitation, "POST", pathOf(spaceId, invitationId, "restore"), {
    user,
    params: { spaceId, invitationId },
  });
const accept = (user: TestUser, token: string) =>
  call(acceptInvitation, "POST", `/api/v1/invitations/${token}/accept`, { user, params: { token } });
const pendingIds = async (user: TestUser, spaceId: string) => {
  const response = await call(listInvitations, "GET", `/api/v1/spaces/${spaceId}/invitations`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { id: string }[] }).items.map((i) => i.id);
};
/** Ana's Household with a MEMBER link she has just revoked. */
const revokedLink = async () => {
  const ana = await registerUser("Ana");
  const spaceId = await newSharedSpace(ana);
  const created = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
    user: ana,
    params: { spaceId },
    body: { kind: "LINK", role: "MEMBER" },
  });
  const { invitation, url } = await created.json();
  expect((await revoke(ana, spaceId, invitation.id)).status).toBe(200);
  return { ana, spaceId, id: invitation.id as string, token: tokenOf(url) };
};

describe("restoring a revoked invitation (ruling P274)", () => {
  it("restores a link revoked moments ago: it is listed again and the link works again, and a second restore changes nothing", async () => {
    const { ana, spaceId, id, token } = await revokedLink();
    const juan = await registerUser("Juan");
    expect(await problemOf(await accept(juan, token))).toEqual([409, "InvitationRevoked"]);
    expect(await pendingIds(ana, spaceId)).toEqual([]);

    clock.advance(10_000);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await restore(ana, spaceId, id);
      expect([response.status, (await response.json()).status]).toEqual([200, "PENDING"]);
    }
    expect(await pendingIds(ana, spaceId)).toEqual([id]);
    expect((await accept(juan, token)).status).toBe(200);
  });

  it("refuses to restore more than 30 seconds after the revoke, and the link stays revoked", async () => {
    const { ana, spaceId, id, token } = await revokedLink();
    clock.advance(31_000);
    expect(await problemOf(await restore(ana, spaceId, id))).toEqual([409, "InvitationNotRestorable"]);
    expect(await problemOf(await accept(await registerUser("Juan"), token))).toEqual([
      409,
      "InvitationRevoked",
    ]);
  });

  it("does not let a VIEWER restore an invitation", async () => {
    const { ana, spaceId, id } = await revokedLink();
    const sofi = await registerUser("Sofi");
    await joinAs(ana, spaceId, sofi, "VIEWER");
    expect(await problemOf(await restore(sofi, spaceId, id))).toEqual([403, "InsufficientRole"]);
    const { rows } = await app.pool.query("SELECT status FROM space_invitations WHERE id = $1", [id]);
    expect(rows[0].status).toBe("REVOKED");
  });
});
