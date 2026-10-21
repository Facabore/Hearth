import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import { createAcceptInvitation } from "./accept-invitation";
import { createClaimGuestPlace } from "./claim-guest-place";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createCreateInvitation } from "./create-invitation";
import { createPreviewClaim, createPreviewInvitation } from "./preview-invitation";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const asAna = { spaceId: space, userId: "u-ana" };
const DAY = 24 * 60 * 60 * 1000;

const world = () => {
  const w = invitationsWorld();
  return {
    ...w,
    invite: createCreateInvitation(w.deps),
    preview: createPreviewInvitation(w.deps),
    previewClaim: createPreviewClaim(w.deps),
  };
};

describe("PreviewInvitation (HU-E9-05, ruling P156)", () => {
  it("answers the space, the inviter, the role, the status and the expiry of a link, and nothing else", async () => {
    const w = world();
    unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    expect(unwrap(await w.preview({ token: "token-1" }))).toEqual({
      kind: "LINK",
      spaceName: "Household",
      role: "MEMBER",
      status: "PENDING",
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      invitedBy: "Ana",
    });
  });

  it("never carries the address of an email invitation", async () => {
    const w = world();
    unwrap(
      await w.invite({ ...asAna, role: "VIEWER", target: { kind: "EMAIL", email: "juan@example.com" } }),
    );
    const preview = unwrap(await w.preview({ token: "token-1" }));
    expect(preview).toMatchObject({ kind: "EMAIL", role: "VIEWER" });
    expect(JSON.stringify(preview)).not.toContain("juan@example.com");
  });

  it("reports revoked, used and expired invitations by their status", async () => {
    const w = world();
    const revoked = unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    unwrap(await createRevokeInvitation(w.deps)({ ...asAna, invitationId: revoked.invitation.id }));
    unwrap(
      await w.invite({ ...asAna, role: "MEMBER", target: { kind: "EMAIL", email: "marta@example.com" } }),
    );
    unwrap(
      await createAcceptInvitation(w.deps)({
        token: "token-2",
        userId: "u-marta",
        userEmail: "marta@example.com",
        userName: "Marta",
      }),
    );
    unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    w.clock.set(new Date(new Date("2026-10-12T12:00:00Z").getTime() + 7 * DAY));
    expect(unwrap(await w.preview({ token: "token-1" })).status).toBe("REVOKED");
    expect(unwrap(await w.preview({ token: "token-2" })).status).toBe("ACCEPTED");
    expect(unwrap(await w.preview({ token: "token-3" })).status).toBe("EXPIRED");
  });

  it("answers InvitationNotFound for an unknown token and for a claim link", async () => {
    const w = world();
    unwrap(await createCreateGuestClaim(w.claims)({ ...asAna, memberId: "member-pedro" }));
    expect(codeOf(await w.preview({ token: "token-1" }))).toBe("InvitationNotFound");
    expect(codeOf(await w.preview({ token: "nope" }))).toBe("InvitationNotFound");
  });

  it("names nobody when the inviter has left the space", async () => {
    const w = world();
    unwrap(await w.invite({ spaceId: space, userId: "u-juan", role: "MEMBER", target: { kind: "LINK" } }));
    await w.store.markLeft(space as never, "member-juan" as never, "USER", new Date("2026-10-12T13:00:00Z"));
    expect(unwrap(await w.preview({ token: "token-1" })).invitedBy).toBeNull();
  });
});

describe("PreviewClaim (HU-E9-05, ruling P156)", () => {
  it("answers the space, the guest, the status, the expiry and who sent it", async () => {
    const w = world();
    unwrap(await createCreateGuestClaim(w.claims)({ ...asAna, memberId: "member-pedro" }));
    expect(unwrap(await w.previewClaim({ token: "token-1" }))).toEqual({
      spaceName: "Household",
      guestName: "Pedro",
      status: "PENDING",
      expiresAt: new Date("2026-10-19T12:00:00Z"),
      invitedBy: "Ana",
    });
  });

  it("answers InvitationNotFound for an invitation token", async () => {
    const w = world();
    unwrap(await w.invite({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    expect(codeOf(await w.previewClaim({ token: "token-1" }))).toBe("InvitationNotFound");
  });

  it("reports a claimed link as ACCEPTED and names no guest once the place has an account", async () => {
    const w = world();
    unwrap(await createCreateGuestClaim(w.claims)({ ...asAna, memberId: "member-pedro" }));
    unwrap(await createClaimGuestPlace(w.claims)({ token: "token-1", userId: "u-pedro" }));
    expect(unwrap(await w.previewClaim({ token: "token-1" }))).toMatchObject({
      status: "ACCEPTED",
      guestName: null,
    });
  });
});
