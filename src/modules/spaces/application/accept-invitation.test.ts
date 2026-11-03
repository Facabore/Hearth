import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  HOUSEHOLD_MEMBERS,
  householdSpace,
  InMemorySpaceStore,
  invitationsWorld,
} from "../../../../tests/support/in-memory-spaces";
import { issueInvitation, type InvitationId, type InvitationTarget } from "../domain/invitation";
import type { SpaceId, SpaceMember } from "../domain/space";
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
    expect(w.invitations.rows[0]).toMatchObject({
      status: "PENDING",
      joins: [
        { userId: "u-juan", joinedAt: created },
        { userId: "u-luis", joinedAt: created },
      ],
    });
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("AlreadyMember");
    expect(
      codeOf(
        await w.accept({ token: "token-1", userId: "u-ana", userEmail: "ana@example.com", userName: "Ana" }),
      ),
    ).toBe("AlreadyMember");
  });

  it("lets one person in through an ADMIN link, marks it used by them, and refuses the next person (#218, ruling P264)", async () => {
    const w = await invited({ kind: "LINK" }, "ADMIN");
    w.later(DAY);
    unwrap(await w.accept({ token: "token-1", ...juan }));
    expect(w.invitations.rows[0]).toMatchObject({
      status: "ACCEPTED",
      acceptedAt: new Date(created.getTime() + DAY),
      acceptedByUserId: "u-juan",
      joins: [{ userId: "u-juan", joinedAt: new Date(created.getTime() + DAY) }],
    });
    expect(codeOf(await w.accept({ token: "token-1", ...luis }))).toBe("InvitationAlreadyUsed");
    expect(w.store.members(space).map((m) => [m.displayName, m.role])).toEqual([
      ["Ana", "OWNER"],
      ["Juan", "ADMIN"],
    ]);
    // Read under the same lock as every acceptance, so two people at once cannot both get in.
    expect(w.invitations.locked).toEqual(["id-1", "id-1"]);
  });

  it("holds the space's lifecycle lock while it joins, so a leave, an archive or a money write never interleaves (issue #149)", async () => {
    const w = await invited();
    unwrap(await w.accept({ token: "token-1", ...juan }));
    expect(w.store.locks.lifecycle).toEqual([space]);
    expect(w.invitations.locked).toEqual(["id-1"]);
  });

  it("takes no space lock for a token that names no invitation (issue #149)", async () => {
    const w = await invited();
    expect(codeOf(await w.accept({ token: "token-unknown", ...juan }))).toBe("InvitationNotFound");
    expect(w.store.locks.lifecycle).toEqual([]);
  });

  it("gives a member who left their own member row back, with the invited role and the new join time (issue #90)", async () => {
    const w = await invited({ kind: "LINK" }, "MEMBER");
    unwrap(await w.accept({ token: "token-1", ...juan }));
    const [before] = juanRows(w.store.members(space));
    expect(await w.store.markLeft(space, before!.id, "USER", new Date("2026-10-13T09:00:00Z"))).toBe(true);
    expect(juanRows(w.store.members(space))).toEqual([]);
    w.clock.set(new Date("2026-10-14T09:00:00Z"));
    expect(unwrap(await w.accept({ token: "token-1", ...juan }))).toMatchObject({
      id: space,
      role: "MEMBER",
    });
    expect(juanRows(w.store.members(space))).toEqual([
      { ...before, joinedAt: new Date("2026-10-14T09:00:00Z") },
    ]);
  });

  it("still gives a newcomer who never left a new row (issue #90)", async () => {
    const w = await invited({ kind: "LINK" }, "MEMBER");
    unwrap(await w.accept({ token: "token-1", ...juan }));
    unwrap(await w.accept({ token: "token-1", ...luis }));
    const ids = w.store.members(space).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("numbers the display name of a newcomer whose name is taken", async () => {
    const w = await invited({ kind: "LINK" });
    unwrap(
      await w.accept({ token: "token-1", userId: "u-ana-2", userEmail: "ana2@example.com", userName: "Ana" }),
    );
    expect(w.store.members(space).map((m) => m.displayName)).toEqual(["Ana", "Ana 2"]);
  });

  describe("when concurrent joins take the name", () => {
    /** A store whose first `failures` addMember calls answer nameTaken, as a concurrent join would. */
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

    it("retries with a name not yet refused", async () => {
      const recovering = new NameRaceStore(2);
      const w = await invited({ kind: "LINK" }, "MEMBER", recovering);
      expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("ok");
      // The re-read members never show the refused names here, so only the taken set moves the suffix on.
      expect(recovering.tried).toEqual(["Juan", "Juan 2", "Juan 3"]);
      expect(juanRows(recovering.members(space)).map((m) => m.displayName)).toEqual(["Juan 3"]);
    });

    it("gives up after three attempts with MemberNameTaken and adds nobody", async () => {
      const failing = new NameRaceStore(3);
      const w = await invited({ kind: "LINK" }, "MEMBER", failing);
      expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("MemberNameTaken");
      expect(failing.tried).toEqual(["Juan", "Juan 2", "Juan 3"]);
      expect(juanRows(failing.members(space))).toEqual([]);
    });
  });
});

describe("the order AcceptInvitation refuses in (HU-E1-07, M2-A review)", () => {
  it("answers an accepted email invitation replayed after it expired as used, not expired", async () => {
    const w = await invited();
    unwrap(await w.accept({ token: "token-1", ...juan }));
    w.later(8 * DAY);
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("InvitationAlreadyUsed");
    expect(juanRows(w.store.members(space))).toHaveLength(1);
  });

  it("answers an expired invitation as expired even to the wrong address", async () => {
    const w = await invited();
    w.later(8 * DAY);
    expect(codeOf(await w.accept({ token: "token-1", ...luis }))).toBe("InvitationExpired");
    expect(w.store.members(space).map((m) => m.displayName)).toEqual(["Ana"]);
  });
});

describe("AcceptInvitation into a space that cannot gain members (HU-E1-13, D16)", () => {
  // CreateInvitation refuses these spaces, so the application never issues such an invitation: the rows
  // are inserted by hand, and accepting one must still join nobody.
  const handMade = (spaceId: string) => {
    const store = new InMemorySpaceStore();
    store.seed({
      ...householdSpace([HOUSEHOLD_MEMBERS[0]!, HOUSEHOLD_MEMBERS[4]!]),
      id: "space-direct" as SpaceId,
      kind: "DIRECT",
      name: "Ana & Pedro",
    });
    const world = invitationsWorld({ store });
    world.invitations.rows.push(
      unwrap(
        issueInvitation({
          id: "inv-hand-made" as InvitationId,
          spaceId: spaceId as SpaceId,
          target: toJuan,
          role: "MEMBER",
          tokenHash: "hash(token-hand-made)",
          createdBy: "u-ana",
          now: created,
        }),
      ),
    );
    return { ...world, accept: createAcceptInvitation(world.deps) };
  };

  it("refuses a third member of a direct space and keeps the invitation unused", async () => {
    const w = handMade("space-direct");
    expect(codeOf(await w.accept({ token: "token-hand-made", ...juan }))).toBe("DirectSpaceIsFull");
    expect(w.store.members("space-direct").map((m) => m.displayName)).toEqual(["Ana", "Pedro"]);
    expect(w.invitations.rows[0]?.status).toBe("PENDING");
  });

  it("refuses a second member of a personal space", async () => {
    const w = handMade("space-ana");
    expect(codeOf(await w.accept({ token: "token-hand-made", ...juan }))).toBe("PersonalSpaceNotShareable");
    expect(w.store.members("space-ana")).toHaveLength(1);
  });
});

describe("AcceptInvitation with email verification on (issue #86, ruling P282)", () => {
  /** Ana invited the target; Juan's account confirmed its address when `verified`. */
  const withVerification = async (target: InvitationTarget, verified: boolean) => {
    const w = await invited(target);
    const requested: string[] = [];
    const verifiedEmails = {
      isVerified: async (userId: string) => verified && userId === "u-juan",
      requestVerification: async (email: string) => {
        requested.push(email);
      },
    };
    return { ...w, requested, accept: createAcceptInvitation({ ...w.deps, verifiedEmails }) };
  };

  it("refuses an email invitation with EmailNotVerified while the address is unconfirmed, and asks for a fresh link", async () => {
    const w = await withVerification(toJuan, false);
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("EmailNotVerified");
    expect(juanRows(w.store.members(space))).toEqual([]);
    expect(w.invitations.rows[0]?.status).toBe("PENDING");
    expect(w.requested).toEqual(["juan@example.com"]);
  });

  it("admits a confirmed address and asks for nothing", async () => {
    const w = await withVerification(toJuan, true);
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("ok");
    expect(w.requested).toEqual([]);
  });

  it("asks nothing of a link invitation", async () => {
    const w = await withVerification({ kind: "LINK" }, false);
    expect(codeOf(await w.accept({ token: "token-1", ...juan }))).toBe("ok");
    expect(w.requested).toEqual([]);
  });

  it("answers another address's invitation with InvitationEmailMismatch, never EmailNotVerified", async () => {
    const w = await withVerification(toJuan, false);
    expect(codeOf(await w.accept({ token: "token-1", ...luis }))).toBe("InvitationEmailMismatch");
    expect(w.requested).toEqual([]);
  });

  it("still answers EmailNotVerified when asking for a fresh link fails", async () => {
    const w = await invited();
    const accept = createAcceptInvitation({
      ...w.deps,
      verifiedEmails: {
        isVerified: async () => false,
        requestVerification: async () => {
          throw new Error("mail server down");
        },
      },
    });
    expect(codeOf(await accept({ token: "token-1", ...juan }))).toBe("EmailNotVerified");
  });
});
