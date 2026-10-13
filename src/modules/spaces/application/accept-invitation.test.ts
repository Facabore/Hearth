import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  HOUSEHOLD_MEMBERS,
  InMemorySpaceStore,
  invitationsWorld,
} from "../../../../tests/support/in-memory-spaces";
import type { InvitationTarget } from "../domain/invitation";
import type { SpaceMember } from "../domain/space";
import { createAcceptInvitation } from "./accept-invitation";
import { createCreateInvitation } from "./create-invitation";
import { createRevokeInvitation } from "./revoke-invitation";
import type { AddMemberOutcome } from "./space-member-repository";

const space = "space-household";
const created = new Date("2026-10-12T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const juan = { userId: "u-juan", userEmail: "juan@example.com", userName: "Juan" };
const luis = { userId: "u-luis", userEmail: "luis@example.com", userName: "Luis" };
const toJuan: InvitationTarget = { kind: "EMAIL", email: "juan@example.com" };

/** HU-E1-07 Background: "Ana" (only member of Household) invited the target with the given role. */
const invited = async (
  target: InvitationTarget = toJuan,
  role: "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER",
  store?: InMemorySpaceStore,
) => {
  const world = invitationsWorld({ members: [HOUSEHOLD_MEMBERS[0]!], store });
  unwrap(await createCreateInvitation(world.deps)({ spaceId: space, userId: "u-ana", role, target }));
  return {
    ...world,
    accept: createAcceptInvitation(world.deps),
    later: (ms: number) => world.clock.set(new Date(created.getTime() + ms)),
  };
};
const juanRows = (members: SpaceMember[]) => members.filter((m) => m.userId === "u-juan");

describe("AcceptInvitation (HU-E1-07)", () => {
  it("makes the signed-in invitee a MEMBER with joinedAt set and uses up the email invitation", async () => {
    const w = await invited();
    w.clock.set(new Date("2026-10-13T09:00:00Z"));
    expect(unwrap(await w.accept({ token: "token-1", ...juan }))).toEqual({
      id: space,
      name: "Household",
      kind: "SHARED",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "MEMBER",
    });
    expect(juanRows(w.store.members(space))).toEqual([
      {
        id: "id-2",
        kind: "USER",
        userId: "u-juan",
        displayName: "Juan",
        role: "MEMBER",
        contactEmail: null,
        joinedAt: new Date("2026-10-13T09:00:00Z"),
      },
    ]);
    expect(w.invitations.rows[0]).toMatchObject({
      status: "ACCEPTED",
      acceptedByUserId: "u-juan",
      acceptedAt: new Date("2026-10-13T09:00:00Z"),
    });
    expect(w.invitations.locked).toEqual(["id-1"]);
  });

  it("matches the invited address ignoring case", async () => {
    const w = await invited();
    expect(codeOf(await w.accept({ token: "token-1", ...juan, userEmail: "JUAN@Example.com" }))).toBe("ok");
  });

  it("rejects an invitation created 8 days ago", async () => {
    const w = await invited();
    w.later(8 * DAY);
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("InvitationExpired");
    expect(juanRows(w.store.members(space))).toEqual([]);
  });

  it("accepts until just before 7 days and rejects from exactly 7 days", async () => {
    const early = await invited();
    early.later(7 * DAY - 60_000);
    expect(codeOf(await early.accept({ token: "token-1", ...juan }))).toBe("ok");
    const late = await invited();
    late.later(7 * DAY);
    expect(codeOf(await late.accept({ token: "token-1", ...juan }))).toBe("InvitationExpired");
  });

  it("rejects another account for an email-bound invitation", async () => {
    const w = await invited();
    expect(codeOf(await w.accept({ token: "token-1", ...luis }))).toBe("InvitationEmailMismatch");
    expect(w.store.members(space).map((m) => m.displayName)).toEqual(["Ana"]);
  });

  it("rejects a revoked invitation", async () => {
    const w = await invited();
    unwrap(await createRevokeInvitation(w.deps)({ spaceId: space, userId: "u-ana", invitationId: "id-1" }));
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("InvitationRevoked");
  });

  it("cannot be replayed once used", async () => {
    const w = await invited();
    unwrap(await w.accept({ token: "token-1", ...juan }));
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("InvitationAlreadyUsed");
    expect(juanRows(w.store.members(space))).toHaveLength(1);
  });

  it("reports an unknown token as InvitationNotFound", async () => {
    const w = await invited();
    expect(codeOf(await w.accept({ token: "not-a-token", ...juan }))).toBe("InvitationNotFound");
  });

  it("keeps a link invitation valid for several people and rejects current members", async () => {
    const w = await invited({ kind: "LINK" }, "VIEWER");
    unwrap(await w.accept({ token: "token-1", ...juan }));
    unwrap(await w.accept({ token: "token-1", ...luis }));
    expect(w.store.members(space).map((m) => [m.displayName, m.role])).toEqual([
      ["Ana", "OWNER"],
      ["Juan", "VIEWER"],
      ["Luis", "VIEWER"],
    ]);
    expect(w.invitations.rows[0]?.status).toBe("PENDING");
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("AlreadyMember");
    expect(
      codeOf(
        await w.accept({ token: "token-1", userId: "u-ana", userEmail: "ana@example.com", userName: "Ana" }),
      ),
    ).toBe("AlreadyMember");
  });

  it("numbers the display name of a newcomer whose name is taken", async () => {
    const w = await invited({ kind: "LINK" });
    unwrap(
      await w.accept({ token: "token-1", userId: "u-ana-2", userEmail: "ana2@example.com", userName: "Ana" }),
    );
    expect(w.store.members(space).map((m) => m.displayName)).toEqual(["Ana", "Ana 2"]);
  });

  it("retries with a name not yet refused when concurrent joins take it, and gives up after three attempts", async () => {
    class NameRaceStore extends InMemorySpaceStore {
      /** Display names offered to addMember, in order. */
      readonly tried: string[] = [];
      constructor(private readonly failures: number) {
        super();
      }
      override async addMember(spaceId: string, member: SpaceMember): Promise<AddMemberOutcome> {
        this.tried.push(member.displayName);
        return this.tried.length <= this.failures ? "nameTaken" : super.addMember(spaceId, member);
      }
    }
    const recovering = new NameRaceStore(2);
    const recoveringWorld = await invited({ kind: "LINK" }, "MEMBER", recovering);
    expect(codeOf(await recoveringWorld.accept({ token: "token-1", ...juan }))).toBe("ok");
    // The re-read members never show the refused names here, so only the taken set moves the suffix on.
    expect(recovering.tried).toEqual(["Juan", "Juan 2", "Juan 3"]);
    expect(juanRows(recovering.members(space)).map((m) => m.displayName)).toEqual(["Juan 3"]);
    const failing = await invited({ kind: "LINK" }, "MEMBER", new NameRaceStore(3));
    expect(codeOf(await failing.accept({ token: "token-1", ...juan }))).toBe("MemberNameTaken");
  });
});
