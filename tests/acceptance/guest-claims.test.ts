import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createClaimLink } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { addGuest, household } from "../support/ledger";
import { tokenOf } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const createLink = (user: TestUser, spaceId: string, memberId: string) =>
  call(createClaimLink, "POST", `/api/v1/spaces/${spaceId}/guests/${memberId}/claim-links`, {
    user,
    params: { spaceId, memberId },
  });

describe("claim links (HU-E1-11)", () => {
  it("creates a pending claim link for the guest Pedro whose URL carries only a token, stored hashed", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const response = await createLink(h.ana, h.spaceId, pedro);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { invitation: { id: string }; url: string };
    expect(body).toEqual({
      invitation: {
        id: expect.any(String),
        spaceId: h.spaceId,
        kind: "CLAIM",
        email: null,
        role: "MEMBER",
        status: "PENDING",
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      },
      url: expect.stringMatching(/^http:\/\/localhost:3000\/claims\/[A-Za-z0-9_-]{43}$/),
      emailSent: false,
    });
    const { rows } = await app.pool.query(
      "SELECT token_hash, guest_member_id FROM space_invitations WHERE id = $1",
      [body.invitation.id],
    );
    expect(rows[0]).toEqual({
      token_hash: createHash("sha256").update(tokenOf(body.url)).digest("hex"),
      guest_member_id: pedro,
    });
  });

  it("refuses Juan, a MEMBER, and hides the space from non-members", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    expect(await problemOf(await createLink(h.juan, h.spaceId, pedro))).toEqual([403, "InsufficientRole"]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await createLink(marta, h.spaceId, pedro))).toEqual([404, "SpaceNotFound"]);
  });

  it("creates claim links only for current guests", async () => {
    const h = await household();
    expect(await problemOf(await createLink(h.ana, h.spaceId, h.juan.memberId))).toEqual([409, "NotAGuest"]);
    for (const memberId of ["0190a0b0-0000-7000-8000-000000000000", "not-a-uuid"]) {
      expect(await problemOf(await createLink(h.ana, h.spaceId, memberId))).toEqual([404, "MemberNotFound"]);
    }
  });
});
