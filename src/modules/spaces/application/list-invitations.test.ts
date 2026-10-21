import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createCreateInvitation } from "./create-invitation";
import { createListInvitations } from "./list-invitations";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const DAY = 24 * 60 * 60 * 1000;

describe("ListInvitations (HU-E9-05, ruling P155)", () => {
  it("lists the pending email and link invitations, newest first, without claim links or used ones", async () => {
    const w = invitationsWorld();
    const create = createCreateInvitation(w.deps);
    const asAna = { spaceId: space, userId: "u-ana" };
    const marta = unwrap(
      await create({ ...asAna, role: "MEMBER", target: { kind: "EMAIL", email: "marta@example.com" } }),
    );
    w.clock.set(new Date("2026-10-12T13:00:00Z"));
    const link = unwrap(await create({ ...asAna, role: "VIEWER", target: { kind: "LINK" } }));
    const revoked = unwrap(await create({ ...asAna, role: "MEMBER", target: { kind: "LINK" } }));
    unwrap(await createRevokeInvitation(w.deps)({ ...asAna, invitationId: revoked.invitation.id }));
    unwrap(await createCreateGuestClaim(w.claims)({ ...asAna, memberId: "member-pedro" }));
    const listed = unwrap(await createListInvitations(w.deps)(asAna));
    expect(listed.map((i) => [i.id, i.kind, i.role, i.status])).toEqual([
      [link.invitation.id, "LINK", "VIEWER", "PENDING"],
      [marta.invitation.id, "EMAIL", "MEMBER", "PENDING"],
    ]);
    expect(listed[1]!.email).toBe("marta@example.com");
  });

  it("leaves out an invitation from the instant it expires", async () => {
    const w = invitationsWorld();
    unwrap(
      await createCreateInvitation(w.deps)({
        spaceId: space,
        userId: "u-ana",
        role: "MEMBER",
        target: { kind: "LINK" },
      }),
    );
    w.clock.set(new Date(new Date("2026-10-12T12:00:00Z").getTime() + 7 * DAY));
    expect(unwrap(await createListInvitations(w.deps)({ spaceId: space, userId: "u-ana" }))).toEqual([]);
  });

  it("answers InsufficientRole to a MEMBER and SpaceNotFound to someone outside the space", async () => {
    const w = invitationsWorld();
    const list = createListInvitations(w.deps);
    expect(codeOf(await list({ spaceId: space, userId: "u-luis" }))).toBe("InsufficientRole");
    expect(unwrap(await list({ spaceId: space, userId: "u-juan" }))).toEqual([]);
    expect(codeOf(await list({ spaceId: space, userId: "u-stranger" }))).toBe("SpaceNotFound");
  });
});
