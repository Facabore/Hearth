import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld, memberOf } from "../../../../tests/support/in-memory-spaces";
import type { SpaceMember } from "../domain/space";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createCreateInvitation } from "./create-invitation";
import { createInvitationAdmitsSignUp } from "./invitation-admits-sign-up";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const DAY = 24 * 60 * 60 * 1000;
const ANA = memberOf("Ana", "OWNER", 0);
const PEDRO: SpaceMember = { ...memberOf("Pedro", null, 2), contactEmail: "pedro@example.com" };

const world = () => {
  const w = invitationsWorld({ members: [ANA, PEDRO] });
  const tokenOf = (url: string) => url.split("/").pop()!;
  return {
    ...w,
    admits: createInvitationAdmitsSignUp(w.deps),
    emailInvitation: async (email = "juan@example.com") =>
      tokenOf(
        unwrap(
          await createCreateInvitation(w.deps)({
            spaceId: space,
            userId: "u-ana",
            role: "MEMBER",
            target: { kind: "EMAIL", email },
          }),
        ).url,
      ),
    linkInvitation: async () =>
      tokenOf(
        unwrap(
          await createCreateInvitation(w.deps)({
            spaceId: space,
            userId: "u-ana",
            role: "MEMBER",
            target: { kind: "LINK" },
          }),
        ).url,
      ),
    claimLink: async () =>
      tokenOf(
        unwrap(
          await createCreateGuestClaim(w.claims)({
            spaceId: space,
            userId: "u-ana",
            memberId: "member-pedro",
          }),
        ).url,
      ),
    revoke: createRevokeInvitation(w.deps),
  };
};

describe("InvitationAdmitsSignUp (ruling P143)", () => {
  it("admits the address an email invitation names, however the sign-up spells it", async () => {
    const w = world();
    const token = await w.emailInvitation("Juan@Example.com");
    expect(await w.admits({ token, email: "juan@example.com" })).toBe(true);
  });

  it("refuses an email invitation for another address", async () => {
    const w = world();
    const token = await w.emailInvitation("juan@example.com");
    expect(await w.admits({ token, email: "marta@example.com" })).toBe(false);
  });

  it("admits a link invitation for any address", async () => {
    const w = world();
    const token = await w.linkInvitation();
    expect(await w.admits({ token, email: "anyone@example.com" })).toBe(true);
  });

  it("admits a claim link for any address", async () => {
    const w = world();
    const token = await w.claimLink();
    expect(await w.admits({ token, email: "pedro@example.com" })).toBe(true);
    expect(await w.admits({ token, email: "someone-else@example.com" })).toBe(true);
  });

  it("refuses an unknown token", async () => {
    const w = world();
    expect(await w.admits({ token: "nope", email: "juan@example.com" })).toBe(false);
  });

  it("refuses expired, revoked and used invitations and claim links", async () => {
    const w = world();
    const expired = await w.linkInvitation();
    const expiredClaim = await w.claimLink();
    w.clock.set(new Date(w.clock.now().getTime() + 7 * DAY));
    expect(await w.admits({ token: expired, email: "juan@example.com" })).toBe(false);
    expect(await w.admits({ token: expiredClaim, email: "juan@example.com" })).toBe(false);

    const fresh = world();
    const revoked = await fresh.linkInvitation();
    unwrap(
      await fresh.revoke({ spaceId: space, userId: "u-ana", invitationId: fresh.invitations.rows[0]!.id }),
    );
    expect(await fresh.admits({ token: revoked, email: "juan@example.com" })).toBe(false);

    const used = world();
    const email = await used.emailInvitation("juan@example.com");
    used.invitations.rows = used.invitations.rows.map((i) => ({ ...i, status: "ACCEPTED" as const }));
    expect(await used.admits({ token: email, email: "juan@example.com" })).toBe(false);
    const usedClaim = await used.claimLink();
    used.invitations.rows = used.invitations.rows.map((i) => ({ ...i, status: "ACCEPTED" as const }));
    expect(await used.admits({ token: usedClaim, email: "juan@example.com" })).toBe(false);
  });

  it("changes nothing: the invitation stays pending and usable", async () => {
    const w = world();
    const token = await w.emailInvitation("juan@example.com");
    const before = structuredClone(w.invitations.rows);
    await w.admits({ token, email: "juan@example.com" });
    expect(w.invitations.rows).toEqual(before);
  });
});
