import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createAcceptInvitation } from "./accept-invitation";
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

  it("counts the people who joined through each link, and gives an email invitation no count (#218, ruling P264)", async () => {
    const w = invitationsWorld();
    const create = createCreateInvitation(w.deps);
    const accept = createAcceptInvitation(w.deps);
    const asAna = { spaceId: space, userId: "u-ana" };
    unwrap(await create({ ...asAna, role: "MEMBER", target: { kind: "EMAIL", email: "marta@example.com" } }));
    w.clock.set(new Date("2026-10-12T13:00:00Z"));
    unwrap(await create({ ...asAna, role: "VIEWER", target: { kind: "LINK" } }));
    w.clock.set(new Date("2026-10-12T14:00:00Z"));
    unwrap(await create({ ...asAna, role: "ADMIN", target: { kind: "LINK" } }));
    for (const name of ["Marta", "Pablo"])
      unwrap(
        await accept({
          token: "token-2",
          userId: `u-${name.toLowerCase()}`,
          userEmail: `${name.toLowerCase()}@example.com`,
          userName: name,
        }),
      );
    const listed = unwrap(await createListInvitations(w.deps)(asAna));
    expect(listed.map((i) => [i.kind, i.role, i.singleUse, i.uses])).toEqual([
      ["LINK", "ADMIN", true, 0],
      ["LINK", "VIEWER", false, 2],
      ["EMAIL", "MEMBER", true, null],
    ]);
  });

  it("leaves out an ADMIN link once someone joined through it (#218, ruling P264)", async () => {
    const w = invitationsWorld();
    const asAna = { spaceId: space, userId: "u-ana" };
    unwrap(await createCreateInvitation(w.deps)({ ...asAna, role: "ADMIN", target: { kind: "LINK" } }));
    unwrap(
      await createAcceptInvitation(w.deps)({
        token: "token-1",
        userId: "u-marta",
        userEmail: "marta@example.com",
        userName: "Marta",
      }),
    );
    expect(unwrap(await createListInvitations(w.deps)(asAna))).toEqual([]);
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
