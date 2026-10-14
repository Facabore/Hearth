import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { POST as createClaimLink } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { addGuest, balancesOf, cop, household, post, type TransactionDto } from "../support/ledger";
import { claimLink, inviteByLink, newSharedSpace, tokenOf } from "../support/spaces";

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

  it("requires a signed-in user and creates no link without one", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const anonymous = await call(
      createClaimLink,
      "POST",
      `/api/v1/spaces/${h.spaceId}/guests/${pedro}/claim-links`,
      { params: { spaceId: h.spaceId, memberId: pedro } },
    );
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    const { rows } = await app.pool.query(
      "SELECT count(*)::int AS claims FROM space_invitations WHERE space_id = $1 AND kind = 'CLAIM'",
      [h.spaceId],
    );
    expect(rows[0].claims).toBe(0);
  });
});

interface MemberDto {
  id: string;
  kind: string;
  userId: string | null;
  displayName: string;
  role: string | null;
  contactEmail: string | null;
  joinedAt: string;
}
const claim = (user: TestUser, token: string) =>
  call(acceptClaim, "POST", `/api/v1/claims/${token}/accept`, { user, params: { token } });
const membersOf = async (user: TestUser, spaceId: string): Promise<MemberDto[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: MemberDto[] }).items;
};
const memberIn = async (user: TestUser, spaceId: string, memberId: string) =>
  (await membersOf(user, spaceId)).find((m) => m.id === memberId);

/**
 * HU-E1-11 Background: Household with OWNER Ana, MEMBER Juan and the guest Pedro; Ana recorded on
 * 2026-10-08 a 300,000 COP "Hotel" paid by Pedro, split EQUAL among the three, and a claim link for Pedro.
 */
const claimBackground = async () => {
  const h = await household();
  const pedro = await addGuest(h, "Pedro");
  const hotel = await post(recordExpense, h.ana, "expenses", {
    description: "Hotel",
    date: "2026-10-08",
    categoryId: h.groceries,
    amount: cop(300_000),
    payments: [{ memberId: pedro, accountId: null, amount: cop(300_000) }],
    split: {
      method: "EQUAL",
      participants: [h.ana.memberId, h.juan.memberId, pedro].map((memberId) => ({ memberId })),
    },
  });
  if (hotel.status !== 201) throw new Error(`hotel failed with status ${hotel.status}`);
  return {
    h,
    pedro,
    hotel: (await hotel.json()) as TransactionDto,
    link: await claimLink(h.ana, h.spaceId, pedro),
  };
};

describe("claim a guest place (HU-E1-11)", () => {
  it("lets a newcomer register and claim Pedro's place, keeping his history (@critical)", async () => {
    const { h, pedro, hotel, link } = await claimBackground();
    const pedroUser = await registerUser("Pedro");
    const response = await claim(pedroUser, link.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: h.spaceId,
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "MEMBER",
    });
    expect(await memberIn(h.ana, h.spaceId, pedro)).toEqual({
      id: pedro,
      kind: "USER",
      userId: pedroUser.userId,
      displayName: "Pedro",
      role: "MEMBER",
      contactEmail: null,
      joinedAt: expect.any(String),
    });
    // The member list shows the claimer in the guest's place: the same member id, and no guest left.
    const memberIds = [h.ana.memberId, h.juan.memberId, pedro];
    const members = await membersOf(h.ana, h.spaceId);
    expect(members.map((m) => m.id)).toEqual(memberIds);
    expect(members.filter((m) => m.kind === "GUEST")).toEqual([]);
    expect((await membersOf(pedroUser, h.spaceId)).map((m) => m.id)).toEqual(memberIds);
    const { rows } = await app.pool.query("SELECT claimed_at FROM space_members WHERE id = $1", [pedro]);
    expect(rows[0].claimed_at).toBeInstanceOf(Date);
    // The unified view is HU-E7-04 (M4); until then Pedro's share is read through the ledger.
    const path = `/api/v1/spaces/${h.spaceId}/transactions?period=2026-10&participantMemberId=${pedro}`;
    const listed = await call(listTransactions, "GET", path, {
      user: pedroUser,
      params: { spaceId: h.spaceId },
    });
    const { items } = (await listed.json()) as { items: TransactionDto[] };
    expect(items.map((t) => t.id)).toEqual([hotel.id]);
    expect(items[0]).toMatchObject({
      payments: [{ memberId: pedro, accountId: null, amount: cop(300_000) }],
      shares: [
        { memberId: h.ana.memberId, amount: cop(100_000) },
        { memberId: h.juan.memberId, amount: cop(100_000) },
        { memberId: pedro, amount: cop(100_000) },
      ],
    });
    // Ana owes Pedro 100,000 COP and Juan owes Pedro 100,000 COP.
    expect(await balancesOf(pedroUser, h.spaceId)).toEqual([
      [h.ana.memberId, cop(-100_000)],
      [h.juan.memberId, cop(-100_000)],
      [pedro, cop(200_000)],
    ]);
  });

  it("links an account that already has spaces of its own, which keeps exactly one personal space", async () => {
    const { h, pedro, link } = await claimBackground();
    // Pedro signed up long before and already owns a shared space of his own.
    const pedroUser = await registerUser("Pedro");
    const pedrosTrip = await newSharedSpace(pedroUser, "Pedro's trip");
    expect((await claim(pedroUser, link.token)).status).toBe(200);
    expect((await memberIn(h.ana, h.spaceId, pedro))?.userId).toBe(pedroUser.userId);
    const listed = await call(listSpaces, "GET", "/api/v1/spaces", { user: pedroUser });
    const { items } = (await listed.json()) as { items: { id: string; kind: string }[] };
    expect(items.filter((s) => s.kind === "PERSONAL")).toHaveLength(1);
    expect(items.map((s) => s.id).sort()).toEqual([h.spaceId, pedroUser.spaceId, pedrosTrip].sort());
  });

  it("refuses Juan, who is already a member, and leaves Pedro a guest", async () => {
    const { h, pedro, link } = await claimBackground();
    expect(await problemOf(await claim(h.juan, link.token))).toEqual([409, "AlreadyMember"]);
    expect(await memberIn(h.ana, h.spaceId, pedro)).toMatchObject({
      kind: "GUEST",
      userId: null,
      role: null,
    });
  });

  it("refuses links that expired, were used or were revoked (Review Focus 2)", async () => {
    const expired = await claimBackground();
    await app.pool.query(
      "UPDATE space_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [expired.link.id],
    );
    expect(await problemOf(await claim(await registerUser("Pedro"), expired.link.token))).toEqual([
      409,
      "InvitationExpired",
    ]);

    const used = await claimBackground();
    expect((await claim(await registerUser("Pedro"), used.link.token)).status).toBe(200);
    expect(await problemOf(await claim(await registerUser("Marta"), used.link.token))).toEqual([
      409,
      "GuestAlreadyClaimed",
    ]);

    const revoked = await claimBackground();
    const { spaceId } = revoked.h;
    const revocation = await call(
      revokeInvitation,
      "POST",
      `/api/v1/spaces/${spaceId}/invitations/${revoked.link.id}/revoke`,
      { user: revoked.h.ana, params: { spaceId, invitationId: revoked.link.id } },
    );
    expect(revocation.status).toBe(200);
    expect(await problemOf(await claim(await registerUser("Pedro"), revoked.link.token))).toEqual([
      409,
      "InvitationRevoked",
    ]);
  });

  it("claims only in its own space: the guest Pedro of Trip 2026 stays a guest (Review Focus 2)", async () => {
    const { h, link } = await claimBackground();
    const trip = await newSharedSpace(h.ana, "Trip 2026");
    const added = await call(addGuestMember, "POST", `/api/v1/spaces/${trip}/guests`, {
      user: h.ana,
      params: { spaceId: trip },
      body: { displayName: "Pedro" },
    });
    const tripPedro = ((await added.json()) as { id: string }).id;
    const pedroUser = await registerUser("Pedro");
    expect((await claim(pedroUser, link.token)).status).toBe(200);
    expect(await memberIn(h.ana, trip, tripPedro)).toMatchObject({ kind: "GUEST", userId: null });
    const tripPath = `/api/v1/spaces/${trip}/transactions?period=2026-10`;
    const tripMoney = await call(listTransactions, "GET", tripPath, {
      user: pedroUser,
      params: { spaceId: trip },
    });
    expect(await problemOf(tripMoney)).toEqual([404, "SpaceNotFound"]);
  });

  it("keeps invitation and claim tokens apart and answers unknown tokens with 404 (Review Focus 2)", async () => {
    const { h, pedro, link } = await claimBackground();
    const luis = await registerUser("Luis");
    const asInvitation = await call(acceptInvitation, "POST", `/api/v1/invitations/${link.token}/accept`, {
      user: luis,
      params: { token: link.token },
    });
    expect(await problemOf(asInvitation)).toEqual([404, "InvitationNotFound"]);
    const invitationToken = await inviteByLink(h.ana, h.spaceId, "MEMBER");
    expect(await problemOf(await claim(luis, invitationToken))).toEqual([404, "InvitationNotFound"]);
    expect(await problemOf(await claim(luis, "no-such-token"))).toEqual([404, "InvitationNotFound"]);
    expect(await memberIn(h.ana, h.spaceId, pedro)).toMatchObject({ kind: "GUEST" });
    expect((await membersOf(h.ana, h.spaceId)).map((m) => m.displayName)).toEqual(["Ana", "Juan", "Pedro"]);
  });

  it("requires a signed-in user", async () => {
    const { link } = await claimBackground();
    const anonymous = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      params: { token: link.token },
    });
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });

  it("offers no second claim link for a guest who was already claimed", async () => {
    const { h, pedro, link } = await claimBackground();
    expect((await claim(await registerUser("Pedro"), link.token)).status).toBe(200);
    expect(await problemOf(await createLink(h.ana, h.spaceId, pedro))).toEqual([409, "NotAGuest"]);
  });

  it("never returns or logs a claim token anywhere but in the creation URL", async () => {
    const { h, link } = await claimBackground();
    const luis = await addGuest(h, "Luis");
    const second = await claimLink(h.ana, h.spaceId, luis);
    const unknown = "u".repeat(43);
    // What would give a link away: the tokens themselves, their stored hashes and an echoed unknown token.
    const { rows } = await app.pool.query<{ token_hash: string }>(
      "SELECT token_hash FROM space_invitations WHERE id = ANY($1)",
      [[link.id, second.id]],
    );
    const secrets = [link.token, second.token, unknown, ...rows.map((r) => r.token_hash)];
    expect(secrets).toHaveLength(5);
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.join(" "))),
    );
    const exchanges: [number, string][] = [];
    const record = async (response: Response) =>
      void exchanges.push([response.status, await response.text()]);
    try {
      const pedroUser = await registerUser("Pedro");
      const marta = await registerUser("Marta");
      await record(await claim(pedroUser, link.token));
      await record(await claim(marta, link.token));
      await record(
        await call(revokeInvitation, "POST", `/api/v1/spaces/${h.spaceId}/invitations/${second.id}/revoke`, {
          user: h.ana,
          params: { spaceId: h.spaceId, invitationId: second.id },
        }),
      );
      await record(await claim(marta, second.token));
      await record(await claim(marta, unknown));
      await record(
        await call(acceptInvitation, "POST", `/api/v1/invitations/${second.token}/accept`, {
          user: marta,
          params: { token: second.token },
        }),
      );
      await record(
        await call(listMembers, "GET", `/api/v1/spaces/${h.spaceId}/members`, {
          user: h.ana,
          params: { spaceId: h.spaceId },
        }),
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    // Every step really answered, so the checks below are not vacuous: claimed, used, revoked, revoked, unknown, wrong route, listed.
    expect(exchanges.map(([status]) => status)).toEqual([200, 409, 200, 409, 404, 404, 200]);
    for (const secret of secrets) {
      expect(exchanges.filter(([, body]) => body.includes(secret))).toEqual([]);
      expect(logged.filter((line) => line.includes(secret))).toEqual([]);
    }
  });
});
