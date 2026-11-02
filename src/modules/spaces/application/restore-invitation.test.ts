import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import { createAcceptInvitation } from "./accept-invitation";
import { createCreateInvitation } from "./create-invitation";
import { createRestoreInvitation } from "./restore-invitation";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const created = new Date("2026-10-12T12:00:00Z");
const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });
const marta = { userId: "u-marta", userEmail: "marta@example.com", userName: "Marta" };

/** Ana invited marta@example.com to Household (OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi) and revoked it at `revokedAt`. */
const revoked = async (revokedAt = new Date(created.getTime() + DAY)) => {
  const world = invitationsWorld();
  const { invitation } = unwrap(
    await createCreateInvitation(world.deps)({
      ...as("ana"),
      role: "MEMBER",
      target: { kind: "EMAIL", email: marta.userEmail },
    }),
  );
  world.clock.set(revokedAt);
  unwrap(await createRevokeInvitation(world.deps)({ ...as("ana"), invitationId: invitation.id }));
  const restore = createRestoreInvitation(world.deps);
  return {
    ...world,
    id: invitation.id,
    restore: (name = "ana", invitationId = invitation.id) => restore({ ...as(name), invitationId }),
    accept: () => createAcceptInvitation(world.deps)({ token: "token-1", ...marta }),
    after: (ms: number) => world.clock.set(new Date(revokedAt.getTime() + ms)),
  };
};

describe("RestoreInvitation (ruling P274)", () => {
  it("brings back an invitation revoked in the last 30 seconds, pending again with no revocation", async () => {
    const w = await revoked();
    w.after(10 * SECOND);
    expect(unwrap(await w.restore()).status).toBe("PENDING");
    expect(w.invitations.rows[0]).toMatchObject({ status: "PENDING", revokedAt: null });
    expect(w.invitations.locked.at(-1)).toBe(w.id);
  });

  it("still restores exactly 30 seconds after the revoke, and refuses a moment later", async () => {
    const onTime = await revoked();
    onTime.after(30 * SECOND);
    expect(codeOf(await onTime.restore())).toBe("ok");
    const late = await revoked();
    late.after(30 * SECOND + 1);
    expect(codeOf(await late.restore())).toBe("InvitationNotRestorable");
    expect(late.invitations.rows[0]!.status).toBe("REVOKED");
  });

  it("refuses an invitation that expired, even within the 30 seconds", async () => {
    // Revoked 10 seconds before its 7 days ran out, restored 15 seconds later.
    const w = await revoked(new Date(created.getTime() + 7 * DAY - 10 * SECOND));
    w.after(15 * SECOND);
    expect(codeOf(await w.restore())).toBe("InvitationNotRestorable");
  });

  it("refuses an invitation that was accepted, and one that was never revoked but expired", async () => {
    const used = await revoked();
    used.invitations.rows = used.invitations.rows.map((i) => ({
      ...i,
      status: "ACCEPTED" as const,
      revokedAt: null,
      acceptedAt: new Date(created.getTime() + DAY),
      acceptedByUserId: marta.userId,
    }));
    expect(codeOf(await used.restore())).toBe("InvitationNotRestorable");
    const stale = await revoked();
    stale.invitations.rows = stale.invitations.rows.map((i) => ({
      ...i,
      status: "PENDING" as const,
      revokedAt: null,
    }));
    stale.clock.set(new Date(created.getTime() + 8 * DAY));
    expect(codeOf(await stale.restore())).toBe("InvitationNotRestorable");
  });

  it("refuses a claim link, which dies with its guest's place", async () => {
    const w = await revoked();
    w.invitations.rows = w.invitations.rows.map((i) => ({
      ...i,
      kind: "CLAIM" as const,
      email: null,
      guestMemberId: "member-pedro",
    }));
    expect(codeOf(await w.restore())).toBe("InvitationNotRestorable");
  });

  it("is idempotent: a second restore answers the same pending invitation and changes nothing", async () => {
    const w = await revoked();
    const first = unwrap(await w.restore());
    const row = w.invitations.rows[0];
    w.after(5 * 60 * SECOND);
    expect(unwrap(await w.restore())).toEqual(first);
    expect(w.invitations.rows[0]).toBe(row);
  });

  it("needs the same permission as revoking: an ADMIN restores, a MEMBER or a VIEWER cannot", async () => {
    const w = await revoked();
    expect(codeOf(await w.restore("luis"))).toBe("InsufficientRole");
    expect(codeOf(await w.restore("sofi"))).toBe("InsufficientRole");
    expect(w.invitations.rows[0]!.status).toBe("REVOKED");
    expect(codeOf(await w.restore("juan"))).toBe("ok");
  });

  it("reports unknown ids and invitations of other spaces as InvitationNotFound", async () => {
    const w = await revoked();
    expect(codeOf(await w.restore("ana", "id-999"))).toBe("InvitationNotFound");
    const other = createRestoreInvitation(w.deps);
    expect(codeOf(await other({ spaceId: "space-ana", userId: "u-ana", invitationId: w.id }))).toBe(
      "InvitationNotFound",
    );
  });

  it("keeps a revoked invitation from being accepted until it is restored", async () => {
    const w = await revoked();
    expect(codeOf(await w.accept())).toBe("InvitationRevoked");
    unwrap(await w.restore());
    expect(codeOf(await w.accept())).toBe("ok");
  });
});
