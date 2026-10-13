import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld, RecordingEmailSender } from "../../../../tests/support/in-memory-spaces";
import { createCreateInvitation } from "./create-invitation";
import { createRevokeInvitation } from "./revoke-invitation";

const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });
const toJuan = { kind: "EMAIL" as const, email: "juan@example.com" };

describe("CreateInvitation (HU-E1-06)", () => {
  it("creates a pending email invitation bound to the address, valid 7 days, and emails its link", async () => {
    const { deps, invitations, emailSender } = invitationsWorld();
    const created = unwrap(
      await createCreateInvitation(deps)({
        ...as("ana"),
        role: "MEMBER",
        target: { kind: "EMAIL", email: "Juan@Example.com" },
      }),
    );
    expect(created).toEqual({
      invitation: {
        id: "id-1",
        spaceId: space,
        kind: "EMAIL",
        email: "juan@example.com",
        role: "MEMBER",
        status: "PENDING",
        createdAt: new Date("2026-10-12T12:00:00Z"),
        expiresAt: new Date("2026-10-19T12:00:00Z"),
      },
      url: "https://hearth.test/invitations/token-1",
      emailSent: true,
    });
    expect(invitations.rows).toEqual([
      expect.objectContaining({ id: "id-1", tokenHash: "hash(token-1)", createdBy: "u-ana" }),
    ]);
    expect(emailSender.sent).toEqual([
      { to: "juan@example.com", spaceName: "Household", url: "https://hearth.test/invitations/token-1" },
    ]);
  });

  it("creates link invitations whose URLs carry only distinct tokens and sends no email", async () => {
    const { deps, invitations, emailSender } = invitationsWorld();
    const create = createCreateInvitation(deps);
    const first = unwrap(await create({ ...as("ana"), role: "MEMBER", target: { kind: "LINK" } }));
    const second = unwrap(await create({ ...as("ana"), role: "VIEWER", target: { kind: "LINK" } }));
    expect(first).toMatchObject({
      invitation: { kind: "LINK", email: null, role: "MEMBER", status: "PENDING" },
      url: "https://hearth.test/invitations/token-1",
      emailSent: false,
    });
    expect(second.url).toBe("https://hearth.test/invitations/token-2");
    expect(invitations.rows.map((i) => i.tokenHash)).toEqual(["hash(token-1)", "hash(token-2)"]);
    expect(emailSender.sent).toEqual([]);
  });

  it("never grants OWNER", async () => {
    const { deps, invitations } = invitationsWorld();
    expect(codeOf(await createCreateInvitation(deps)({ ...as("ana"), role: "OWNER", target: toJuan }))).toBe(
      "InvalidInvitationRole",
    );
    expect(invitations.rows).toEqual([]);
  });

  it("rejects the address of a current member", async () => {
    const { deps, invitations } = invitationsWorld({ users: { "juan@example.com": "u-juan" } });
    expect(codeOf(await createCreateInvitation(deps)({ ...as("ana"), role: "MEMBER", target: toJuan }))).toBe(
      "AlreadyMember",
    );
    expect(invitations.rows).toEqual([]);
  });

  it("invites a registered user who is not a member", async () => {
    const { deps } = invitationsWorld({ users: { "marta@example.com": "u-marta" } });
    const result = await createCreateInvitation(deps)({
      ...as("ana"),
      role: "VIEWER",
      target: { kind: "EMAIL", email: "marta@example.com" },
    });
    expect(codeOf(result)).toBe("ok");
  });

  it("lets admins invite but not members (HU-E1-05)", async () => {
    const { deps } = invitationsWorld();
    const create = createCreateInvitation(deps);
    expect(codeOf(await create({ ...as("juan"), role: "MEMBER", target: { kind: "LINK" } }))).toBe("ok");
    expect(codeOf(await create({ ...as("luis"), role: "MEMBER", target: { kind: "LINK" } }))).toBe(
      "InsufficientRole",
    );
  });

  it("refuses personal spaces (HU-E1-02)", async () => {
    const { deps } = invitationsWorld();
    const result = await createCreateInvitation(deps)({
      spaceId: "space-ana",
      userId: "u-ana",
      role: "MEMBER",
      target: toJuan,
    });
    expect(codeOf(result)).toBe("PersonalSpaceNotShareable");
  });

  it("keeps the invitation when the email cannot be sent", async () => {
    const { deps, invitations } = invitationsWorld({ emailSender: new RecordingEmailSender("throws") });
    const created = unwrap(
      await createCreateInvitation(deps)({ ...as("ana"), role: "MEMBER", target: toJuan }),
    );
    expect(created.emailSent).toBe(false);
    expect(invitations.rows).toHaveLength(1);
  });

  it("reports emailSent false when delivery is disabled", async () => {
    const { deps } = invitationsWorld({ emailSender: new RecordingEmailSender("disabled") });
    const created = unwrap(
      await createCreateInvitation(deps)({ ...as("ana"), role: "MEMBER", target: toJuan }),
    );
    expect(created).toMatchObject({ url: "https://hearth.test/invitations/token-1", emailSent: false });
  });

  it("hides the space from non-members", async () => {
    const { deps } = invitationsWorld();
    expect(
      codeOf(await createCreateInvitation(deps)({ ...as("marta"), role: "MEMBER", target: toJuan })),
    ).toBe("SpaceNotFound");
  });
});

describe("RevokeInvitation (HU-E1-06)", () => {
  const pending = async () => {
    const world = invitationsWorld();
    const created = unwrap(
      await createCreateInvitation(world.deps)({ ...as("ana"), role: "MEMBER", target: toJuan }),
    );
    return { ...world, id: created.invitation.id, revoke: createRevokeInvitation(world.deps) };
  };

  it("revokes a pending invitation", async () => {
    const { revoke, id, invitations, clock } = await pending();
    clock.set(new Date("2026-10-13T08:00:00Z"));
    expect(unwrap(await revoke({ ...as("ana"), invitationId: id })).status).toBe("REVOKED");
    expect(invitations.rows[0]).toMatchObject({
      status: "REVOKED",
      revokedAt: new Date("2026-10-13T08:00:00Z"),
    });
    expect(invitations.locked).toEqual([id]);
  });

  it("changes nothing when revoked twice", async () => {
    const { revoke, id, invitations } = await pending();
    unwrap(await revoke({ ...as("ana"), invitationId: id }));
    const before = invitations.rows[0];
    expect(unwrap(await revoke({ ...as("juan"), invitationId: id })).status).toBe("REVOKED");
    expect(invitations.rows[0]).toBe(before);
  });

  it("cannot revoke a used email invitation", async () => {
    const { revoke, id, invitations } = await pending();
    invitations.rows = invitations.rows.map((i) => ({
      ...i,
      status: "ACCEPTED" as const,
      acceptedAt: new Date("2026-10-12T13:00:00Z"),
      acceptedByUserId: "u-juan",
    }));
    expect(codeOf(await revoke({ ...as("ana"), invitationId: id }))).toBe("InvitationAlreadyUsed");
  });

  it("reports unknown ids and invitations of other spaces as InvitationNotFound", async () => {
    const { revoke, id } = await pending();
    expect(codeOf(await revoke({ ...as("ana"), invitationId: "id-999" }))).toBe("InvitationNotFound");
    expect(codeOf(await revoke({ spaceId: "space-ana", userId: "u-ana", invitationId: id }))).toBe(
      "InvitationNotFound",
    );
  });

  it("lets only owners and admins revoke", async () => {
    const { revoke, id } = await pending();
    expect(codeOf(await revoke({ ...as("luis"), invitationId: id }))).toBe("InsufficientRole");
  });
});
