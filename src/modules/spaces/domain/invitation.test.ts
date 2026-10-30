import { describe, expect, it } from "vitest";
import type { Result } from "@/shared/kernel";
import {
  effectiveStatus,
  ensureAcceptable,
  ensureClaimable,
  isClaim,
  issueClaim,
  isSingleUse,
  issueInvitation,
  markAccepted,
  revokeInvitation,
  type Invitation,
  type InvitationId,
  type InvitationTarget,
} from "./invitation";
import type { SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "./space";

const created = new Date("2026-10-12T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(created.getTime() + ms);
const code = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);
const issue = (target: InvitationTarget, role: SpaceRole = "MEMBER"): Result<Invitation> =>
  issueInvitation({
    id: "inv-1" as InvitationId,
    spaceId: "space-household" as SpaceId,
    target,
    role,
    tokenHash: "hash(token-1)",
    createdBy: "u-ana",
    now: created,
  });
const valid = (target: InvitationTarget): Invitation => {
  const result = issue(target);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
const toJuan = valid({ kind: "EMAIL", email: " Juan@Example.com " });
const link = valid({ kind: "LINK" });
const adminLink = (() => {
  const result = issue({ kind: "LINK" }, "ADMIN");
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
})();
const revoked = (invitation: Invitation): Invitation => {
  const result = revokeInvitation(invitation, at(DAY));
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};

describe("issuing invitations (HU-E1-06)", () => {
  it("binds an email invitation to the lower-cased address and lets it expire 7 days later", () => {
    expect(toJuan).toEqual({
      id: "inv-1",
      spaceId: "space-household",
      kind: "EMAIL",
      email: "juan@example.com",
      guestMemberId: null,
      role: "MEMBER",
      tokenHash: "hash(token-1)",
      status: "PENDING",
      createdBy: "u-ana",
      createdAt: created,
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      joins: [],
    });
  });

  it("binds a link invitation to no address", () => {
    expect(link).toMatchObject({ kind: "LINK", email: null, status: "PENDING" });
  });

  it("never grants OWNER", () => {
    expect(code(issue({ kind: "LINK" }, "OWNER"))).toBe("InvalidInvitationRole");
    expect(code(issue({ kind: "EMAIL", email: "juan@example.com" }, "OWNER"))).toBe("InvalidInvitationRole");
  });

  it("needs an address for an email invitation", () => {
    expect(code(issue({ kind: "EMAIL", email: "   " }))).toBe("InvalidEmail");
  });
});

describe("expiry (Review Focus 1)", () => {
  it("is pending until just before 7 days and expired from exactly 7 days", () => {
    expect(effectiveStatus(toJuan, at(7 * DAY - 1))).toBe("PENDING");
    expect(effectiveStatus(toJuan, at(7 * DAY))).toBe("EXPIRED");
  });

  it("never reports accepted or revoked invitations as expired", () => {
    expect(effectiveStatus(markAccepted(toJuan, "u-juan", at(DAY)), at(30 * DAY))).toBe("ACCEPTED");
    expect(effectiveStatus(revoked(toJuan), at(30 * DAY))).toBe("REVOKED");
  });
});

describe("accepting (HU-E1-07)", () => {
  it("lets the invited address accept, ignoring case", () => {
    expect(code(ensureAcceptable(toJuan, { email: "JUAN@example.com", now: at(DAY) }))).toBe("ok");
  });

  it("rejects an invitation created 8 days ago", () => {
    expect(code(ensureAcceptable(toJuan, { email: "juan@example.com", now: at(8 * DAY) }))).toBe(
      "InvitationExpired",
    );
  });

  it("rejects another address for an email-bound invitation", () => {
    expect(code(ensureAcceptable(toJuan, { email: "luis@example.com", now: at(DAY) }))).toBe(
      "InvitationEmailMismatch",
    );
  });

  it("rejects a revoked invitation, also once it would have expired", () => {
    expect(code(ensureAcceptable(revoked(toJuan), { email: "juan@example.com", now: at(DAY) }))).toBe(
      "InvitationRevoked",
    );
    expect(code(ensureAcceptable(revoked(link), { email: "x@example.com", now: at(8 * DAY) }))).toBe(
      "InvitationRevoked",
    );
  });

  it("uses up an email invitation, so a replay is rejected", () => {
    const accepted = markAccepted(toJuan, "u-juan", at(DAY));
    expect(accepted).toMatchObject({ status: "ACCEPTED", acceptedAt: at(DAY), acceptedByUserId: "u-juan" });
    expect(code(ensureAcceptable(accepted, { email: "juan@example.com", now: at(DAY) }))).toBe(
      "InvitationAlreadyUsed",
    );
  });

  it("keeps a link invitation usable by anyone until it expires, and records each person who joined once", () => {
    const used = markAccepted(markAccepted(link, "u-juan", at(DAY)), "u-luis", at(2 * DAY));
    expect(used).toMatchObject({ status: "PENDING", acceptedAt: null, acceptedByUserId: null });
    expect(used.joins).toEqual([
      { userId: "u-juan", joinedAt: at(DAY) },
      { userId: "u-luis", joinedAt: at(2 * DAY) },
    ]);
    // Joining again (after leaving) is the same person: the first join stays the only one.
    expect(markAccepted(used, "u-juan", at(3 * DAY)).joins).toEqual(used.joins);
    expect(code(ensureAcceptable(used, { email: "anyone@example.com", now: at(DAY) }))).toBe("ok");
    expect(code(ensureAcceptable(link, { email: "anyone@example.com", now: at(DAY) }))).toBe("ok");
    expect(code(ensureAcceptable(link, { email: "anyone@example.com", now: at(7 * DAY) }))).toBe(
      "InvitationExpired",
    );
  });
});

describe("ADMIN links are single use (#218, ruling P264)", () => {
  it("tells single-use invitations apart: email, claim and ADMIN links are; MEMBER and VIEWER links are not", () => {
    expect(isSingleUse(toJuan)).toBe(true);
    expect(isSingleUse(adminLink)).toBe(true);
    expect(isSingleUse(link)).toBe(false);
    const viewerLink = issue({ kind: "LINK" }, "VIEWER");
    expect(viewerLink.ok && isSingleUse(viewerLink.value)).toBe(false);
  });

  it("is used up by its first join: marked ACCEPTED by that person, so a second person is refused", () => {
    const used = markAccepted(adminLink, "u-juan", at(DAY));
    expect(used).toMatchObject({
      status: "ACCEPTED",
      acceptedAt: at(DAY),
      acceptedByUserId: "u-juan",
      joins: [{ userId: "u-juan", joinedAt: at(DAY) }],
    });
    expect(code(ensureAcceptable(used, { email: "luis@example.com", now: at(DAY) }))).toBe(
      "InvitationAlreadyUsed",
    );
  });

  it("refuses an ADMIN link with a recorded join even while its stored status is still PENDING", () => {
    // Whatever wrote the join without the status, a join alone is enough to stop a single-use link.
    const joined: Invitation = { ...adminLink, joins: [{ userId: "u-juan", joinedAt: at(DAY) }] };
    expect(code(ensureAcceptable(joined, { email: "luis@example.com", now: at(DAY) }))).toBe(
      "InvitationAlreadyUsed",
    );
  });

  it("still reports a revoked ADMIN link as revoked, and an unused one as acceptable until it expires", () => {
    expect(code(ensureAcceptable(adminLink, { email: "luis@example.com", now: at(DAY) }))).toBe("ok");
    expect(code(ensureAcceptable(adminLink, { email: "luis@example.com", now: at(7 * DAY) }))).toBe(
      "InvitationExpired",
    );
    expect(code(ensureAcceptable(revoked(adminLink), { email: "luis@example.com", now: at(DAY) }))).toBe(
      "InvitationRevoked",
    );
  });

  it("records no join on a claim link: it hands over a guest's place, nobody joins through it", () => {
    const claim: Invitation = { ...link, kind: "CLAIM", guestMemberId: "member-pedro" };
    expect(markAccepted(claim, "u-pedro", at(DAY))).toMatchObject({ status: "ACCEPTED", joins: [] });
  });
});

describe("revoking (HU-E1-06)", () => {
  it("revokes a pending invitation", () => {
    expect(revoked(toJuan)).toMatchObject({ status: "REVOKED", revokedAt: at(DAY) });
  });

  it("changes nothing when revoked twice", () => {
    const once = revoked(toJuan);
    expect(revokeInvitation(once, at(2 * DAY))).toEqual({ ok: true, value: once });
  });

  it("cannot revoke a used email invitation", () => {
    expect(code(revokeInvitation(markAccepted(toJuan, "u-juan", at(DAY)), at(2 * DAY)))).toBe(
      "InvitationAlreadyUsed",
    );
  });
});

describe("claim links (HU-E1-11)", () => {
  const member = (name: string, role: SpaceRole | null): SpaceMember => ({
    id: `member-${name}` as SpaceMemberId,
    kind: role === null ? "GUEST" : "USER",
    userId: role === null ? null : `u-${name}`,
    displayName: name,
    role,
    contactEmail: null,
    joinedAt: created,
  });
  // The current members of space-household: OWNER Ana, MEMBER Juan and the guest Pedro.
  const household = [member("ana", "OWNER"), member("juan", "MEMBER"), member("pedro", null)];
  const claimFor = (guestMemberId: string): Result<Invitation> =>
    issueClaim({
      id: "inv-2" as InvitationId,
      spaceId: "space-household" as SpaceId,
      guestMemberId,
      current: household,
      tokenHash: "hash(token-2)",
      createdBy: "u-ana",
      now: created,
    });
  const issued = claimFor("member-pedro");
  if (!issued.ok) throw new Error(issued.error.code);
  const claim = issued.value;

  it("binds a pending link to one guest, as MEMBER and without an address, valid 7 days", () => {
    expect(claim).toEqual({
      id: "inv-2",
      spaceId: "space-household",
      kind: "CLAIM",
      email: null,
      guestMemberId: "member-pedro",
      role: "MEMBER",
      tokenHash: "hash(token-2)",
      status: "PENDING",
      createdBy: "u-ana",
      createdAt: created,
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      joins: [],
    });
  });

  it("is issued only for a current guest of its own space, which the schema does not check", () => {
    // Zoe is a guest, but of another space: she is not among household's current members.
    expect(code(claimFor("member-juan"))).toBe("NotAGuest");
    expect(code(claimFor("member-zoe"))).toBe("MemberNotFound");
    expect(code(claimFor("member-nobody"))).toBe("MemberNotFound");
    expect(code(claimFor("not-a-uuid"))).toBe("MemberNotFound");
  });

  it("can be claimed until just before 7 days and not from exactly 7 days", () => {
    expect(code(ensureClaimable(claim, at(7 * DAY - 1)))).toBe("ok");
    expect(code(ensureClaimable(claim, at(7 * DAY)))).toBe("InvitationExpired");
  });

  it("is used up by its first claim, so a second answers GuestAlreadyClaimed (Review Focus 2)", () => {
    const used = markAccepted(claim, "u-pedro", at(DAY));
    expect(used).toMatchObject({ status: "ACCEPTED", acceptedAt: at(DAY), acceptedByUserId: "u-pedro" });
    expect(code(ensureClaimable(used, at(DAY)))).toBe("GuestAlreadyClaimed");
  });

  it("answers InvitationRevoked once revoked, also after it would have expired", () => {
    expect(code(ensureClaimable(revoked(claim), at(DAY)))).toBe("InvitationRevoked");
    expect(code(ensureClaimable(revoked(claim), at(8 * DAY)))).toBe("InvitationRevoked");
  });

  it("tells claim links from invitations", () => {
    expect([isClaim(claim), isClaim(link), isClaim(toJuan)]).toEqual([true, false, false]);
  });
});
