import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld, memberOf } from "../../../../tests/support/in-memory-spaces";
import type { SpaceMember } from "../domain/space";
import { createCreateGuestClaim } from "./create-guest-claim";

const space = "space-household";
const DAY = 24 * 60 * 60 * 1000;
const created = new Date("2026-10-12T12:00:00Z");
// HU-E1-11 Background: OWNER Ana, MEMBER Juan and the guest Pedro, who left a contact email.
const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const PEDRO: SpaceMember = { ...memberOf("Pedro", null, 2), contactEmail: "pedro@example.com" };

const world = () => {
  const w = invitationsWorld({ members: [ANA, JUAN, PEDRO] });
  return { ...w, createClaim: createCreateGuestClaim(w.claims) };
};
type World = ReturnType<typeof world>;
/** Ana creates a claim link for `memberId` (Pedro unless given) in `spaceId` (Household unless given). */
const claimLinkFor = async (w: World, memberId = "member-pedro", spaceId = space) =>
  unwrap(await w.createClaim({ spaceId, userId: "u-ana", memberId }));

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
