import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  householdSpace,
  InMemorySpaceStore,
  invitationsWorld,
  memberOf,
} from "../../../../tests/support/in-memory-spaces";
import type { Space, SpaceId, SpaceMember } from "../domain/space";
import { createAcceptInvitation } from "./accept-invitation";
import { createClaimGuestPlace } from "./claim-guest-place";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createCreateInvitation } from "./create-invitation";
import { createRevokeInvitation } from "./revoke-invitation";
import type { ClaimOutcome } from "./space-member-repository";

const space = "space-household";
const DAY = 24 * 60 * 60 * 1000;
const created = new Date("2026-10-12T12:00:00Z");
// HU-E1-11 Background: OWNER Ana, MEMBER Juan and the guest Pedro, who left a contact email.
const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const PEDRO: SpaceMember = { ...memberOf("Pedro", null, 2), contactEmail: "pedro@example.com" };

const world = (store?: InMemorySpaceStore) => {
  const w = invitationsWorld({ members: [ANA, JUAN, PEDRO], store });
  return {
    ...w,
    createClaim: createCreateGuestClaim(w.claims),
    claim: createClaimGuestPlace(w.claims),
    accept: createAcceptInvitation(w.deps),
    revoke: createRevokeInvitation(w.deps),
  };
};
type World = ReturnType<typeof world>;
/** Ana creates a claim link for `memberId` (Pedro unless given) in `spaceId` (Household unless given). */
const claimLinkFor = async (w: World, memberId = "member-pedro", spaceId = space) =>
  unwrap(await w.createClaim({ spaceId, userId: "u-ana", memberId }));
const pedroOf = (w: World) => w.store.members(space).find((m) => m.id === "member-pedro");

describe("CreateGuestClaim (HU-E1-11)", () => {
  it("creates a pending claim link for Pedro, valid 7 days, whose URL carries only its token", async () => {
    const w = world();
    expect(await claimLinkFor(w)).toEqual({
      invitation: {
        id: "id-1",
        spaceId: space,
        kind: "CLAIM",
        email: null,
        role: "MEMBER",
        status: "PENDING",
        createdAt: created,
        expiresAt: new Date(created.getTime() + 7 * DAY),
      },
      url: "https://hearth.test/claims/token-1",
      emailSent: false,
    });
    expect(w.invitations.rows).toEqual([
      expect.objectContaining({
        kind: "CLAIM",
        guestMemberId: "member-pedro",
        tokenHash: "hash(token-1)",
        createdBy: "u-ana",
      }),
    ]);
    expect(w.emailSender.sent).toEqual([]);
  });

  it("refuses Juan, a MEMBER, and hides the space from non-members", async () => {
    const w = world();
    expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-juan", memberId: "member-pedro" }))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-marta", memberId: "member-pedro" }))).toBe(
      "SpaceNotFound",
    );
    expect(w.invitations.rows).toEqual([]);
  });

  it("creates claim links only for current guests", async () => {
    const w = world();
    expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-ana", memberId: "member-juan" }))).toBe(
      "NotAGuest",
    );
    for (const memberId of ["member-nobody", "not-a-uuid"]) {
      expect(codeOf(await w.createClaim({ spaceId: space, userId: "u-ana", memberId }))).toBe(
        "MemberNotFound",
      );
    }
  });
});

describe("ClaimGuestPlace (HU-E1-11)", () => {
  it("lets a newcomer take over Pedro's place: same id and name, a registered MEMBER, the link used up", async () => {
    const w = world();
    await claimLinkFor(w);
    const claimedAt = new Date("2026-10-13T09:00:00Z");
    w.clock.set(claimedAt);
    expect(unwrap(await w.claim({ token: "token-1", userId: "u-pedro" }))).toEqual({
      id: space,
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "MEMBER",
    });
    expect(pedroOf(w)).toEqual({
      ...PEDRO,
      kind: "USER",
      userId: "u-pedro",
      role: "MEMBER",
      contactEmail: null,
    });
    expect(w.store.claimed).toEqual([{ spaceId: space, memberId: "member-pedro", claimedAt }]);
    expect(w.invitations.rows[0]).toMatchObject({ status: "ACCEPTED", acceptedByUserId: "u-pedro" });
    expect(w.invitations.locked).toEqual(["id-1"]);
  });

  it("refuses Juan, who is already a member, and leaves Pedro a guest", async () => {
    const w = world();
    await claimLinkFor(w);
    expect(codeOf(await w.claim({ token: "token-1", userId: "u-juan" }))).toBe("AlreadyMember");
    expect(pedroOf(w)).toEqual(PEDRO);
    expect(w.invitations.rows[0]?.status).toBe("PENDING");
  });

  it("refuses a current member before it asks the database to touch the guest's row", async () => {
    const attempts: string[] = [];
    const store = new (class extends InMemorySpaceStore {
      override async claimGuest(spaceId: string, claimed: SpaceMember, claimedAt: Date) {
        attempts.push(claimed.id);
        return super.claimGuest(spaceId, claimed, claimedAt);
      }
    })();
    const w = world(store);
    await claimLinkFor(w);
    expect(codeOf(await w.claim({ token: "token-1", userId: "u-juan" }))).toBe("AlreadyMember");
    expect(attempts).toEqual([]);
  });

  it("answers MemberNotFound when the guest was removed after the link was created", async () => {
    const w = world();
    await claimLinkFor(w);
    expect(await w.store.markLeft(space, "member-pedro", "GUEST", created)).toBe(true);
    expect(codeOf(await w.claim({ token: "token-1", userId: "u-marta" }))).toBe("MemberNotFound");
    expect(w.store.claimed).toEqual([]);
    expect(w.invitations.rows[0]?.status).toBe("PENDING");
  });

  it("refuses links that expired, were used or were revoked (Review Focus 2)", async () => {
    const expired = world();
    await claimLinkFor(expired);
    expired.clock.set(new Date(created.getTime() + 8 * DAY));
    expect(codeOf(await expired.claim({ token: "token-1", userId: "u-pedro" }))).toBe("InvitationExpired");

    const used = world();
    await claimLinkFor(used);
    unwrap(await used.claim({ token: "token-1", userId: "u-pedro" }));
    expect(codeOf(await used.claim({ token: "token-1", userId: "u-marta" }))).toBe("GuestAlreadyClaimed");

    const revoked = world();
    await claimLinkFor(revoked);
    unwrap(await revoked.revoke({ spaceId: space, userId: "u-ana", invitationId: "id-1" }));
    expect(codeOf(await revoked.claim({ token: "token-1", userId: "u-pedro" }))).toBe("InvitationRevoked");
    expect(pedroOf(revoked)).toEqual(PEDRO);
  });

  it("answers GuestAlreadyClaimed when another link of the same guest was used first", async () => {
    const w = world();
    await claimLinkFor(w);
    await claimLinkFor(w);
    unwrap(await w.claim({ token: "token-1", userId: "u-pedro" }));
    expect(codeOf(await w.claim({ token: "token-2", userId: "u-marta" }))).toBe("GuestAlreadyClaimed");
    expect(pedroOf(w)?.userId).toBe("u-pedro");
  });

  it("gives one winner when two people claim the same link at once", async () => {
    const w = world();
    await claimLinkFor(w);
    const results = await Promise.all([
      w.claim({ token: "token-1", userId: "u-pedro" }),
      w.claim({ token: "token-1", userId: "u-marta" }),
    ]);
    expect(results.map((r) => (r.ok ? "claimed" : r.error.code)).sort()).toEqual([
      "GuestAlreadyClaimed",
      "claimed",
    ]);
    expect(w.store.claimed).toHaveLength(1);
    expect(w.invitations.rows[0]).toMatchObject({ status: "ACCEPTED", acceptedByUserId: pedroOf(w)?.userId });
    expect(w.store.members(space)).toHaveLength(3);
  });

  it("keeps invitation and claim tokens apart (Review Focus 2)", async () => {
    const w = world();
    await claimLinkFor(w);
    unwrap(
      await createCreateInvitation(w.deps)({
        spaceId: space,
        userId: "u-ana",
        role: "MEMBER",
        target: { kind: "LINK" },
      }),
    );
    expect(codeOf(await w.claim({ token: "token-2", userId: "u-pedro" }))).toBe("InvitationNotFound");
    expect(codeOf(await w.claim({ token: "token-unknown", userId: "u-pedro" }))).toBe("InvitationNotFound");
    const luis = { userId: "u-luis", userEmail: "luis@example.com", userName: "Luis" };
    expect(codeOf(await w.accept({ token: "token-1", ...luis }))).toBe("InvitationNotFound");
    expect(w.store.members(space).map((m) => m.id)).toEqual(["member-ana", "member-juan", "member-pedro"]);
    expect(pedroOf(w)).toEqual(PEDRO);
  });

  it("makes the claimer of a direct space's guest an OWNER (D16)", async () => {
    const store = new InMemorySpaceStore();
    const direct: Space = {
      ...householdSpace([ANA, PEDRO]),
      id: "space-direct" as SpaceId,
      kind: "DIRECT",
      name: "Ana & Pedro",
    };
    store.seed(direct);
    const w = world(store);
    await claimLinkFor(w, "member-pedro", "space-direct");
    expect(unwrap(await w.claim({ token: "token-1", userId: "u-pedro" })).role).toBe("OWNER");
    expect(store.members("space-direct").map((m) => [m.userId, m.role])).toEqual([
      ["u-ana", "OWNER"],
      ["u-pedro", "OWNER"],
    ]);
  });

  it("maps a claim or a join that the database decided first", async () => {
    const racing = (outcome: ClaimOutcome) =>
      new (class extends InMemorySpaceStore {
        override async claimGuest(): Promise<ClaimOutcome> {
          return outcome;
        }
      })();
    const cases = [
      ["notAGuest", "GuestAlreadyClaimed"],
      ["alreadyMember", "AlreadyMember"],
    ] as const;
    for (const [outcome, code] of cases) {
      const w = world(racing(outcome));
      await claimLinkFor(w);
      expect(codeOf(await w.claim({ token: "token-1", userId: "u-pedro" }))).toBe(code);
      expect(w.invitations.rows[0]?.status).toBe("PENDING");
    }
  });
});
