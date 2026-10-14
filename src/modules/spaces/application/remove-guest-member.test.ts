import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, unwrap } from "../../../../tests/support/fakes";
import {
  HOUSEHOLD_MEMBERS,
  householdSpace,
  InMemoryInvitations,
  InMemorySpaceStore,
  memberOf,
} from "../../../../tests/support/in-memory-spaces";
import { issueClaim, issueInvitation, type InvitationId } from "../domain/invitation";
import { createPersonalSpace, type Space, type SpaceId, type SpaceMemberId } from "../domain/space";
import { createRemoveGuestMember, type RemoveGuestDeps } from "./remove-guest-member";
import { createSpaceAccess } from "./space-access";

const now = new Date("2026-10-14T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

/** Net balances of Household by member id (minor units); any other space answers 1, never settled. */
const nets =
  (byMember: Record<string, bigint> = {}): RemoveGuestDeps["netBalance"] =>
  async (spaceId, memberId) =>
    spaceId === space ? (byMember[memberId] ?? 0n) : 1n;
/** Pedro and a second guest, Other, both current guests of Household, so a claim link can name either. */
const guests = [...HOUSEHOLD_MEMBERS, memberOf("Other", null, 5)];
const claimFor = (id: string, guestMemberId: string) =>
  unwrap(
    issueClaim({
      id: id as InvitationId,
      spaceId: space as SpaceId,
      guestMemberId,
      current: guests,
      tokenHash: `hash(${id})`,
      createdBy: "u-ana",
      now,
    }),
  );

// HU-E1-12 Background (HU-E1-05 members): OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const setup = (
  seeded: Space = householdSpace(),
  byMember: Record<string, bigint> = {},
  store = new InMemorySpaceStore(),
) => {
  store.seed(seeded);
  const invitations = new InMemoryInvitations();
  const deps: RemoveGuestDeps = {
    access: createSpaceAccess(store),
    members: store,
    invitations,
    netBalance: nets(byMember),
    clock: new FixedClock(now),
    tm: memoryTm,
  };
  return { store, invitations, deps, remove: createRemoveGuestMember(deps) };
};

describe("RemoveGuestMember (HU-E1-12)", () => {
  it("lets Luis remove Pedro, whose balance is zero: Pedro is no longer a current member", async () => {
    const { store, remove } = setup();
    expect(unwrap(await remove({ ...as("luis"), memberId: "member-pedro" }))).toBeUndefined();
    expect(store.members(space).map((m) => m.id)).toEqual([
      "member-ana",
      "member-juan",
      "member-luis",
      "member-sofi",
    ]);
    expect(store.left).toEqual([{ spaceId: space, memberId: "member-pedro", leftAt: now }]);
  });

  it("refuses removing Pedro while he owes Ana 100,000 COP, stating the amount (Review Focus 1)", async () => {
    const { store, remove } = setup(householdSpace(), {
      "member-ana": 10_000_000n,
      "member-pedro": -10_000_000n,
    });
    expect(await remove({ ...as("ana"), memberId: "member-pedro" })).toEqual({
      ok: false,
      error: {
        code: "OutstandingBalance",
        details: { outstanding: { amount: "10000000", currency: "COP" } },
      },
    });
    expect(store.left).toEqual([]);
  });

  it("refuses a viewer and never removes a registered member as a guest", async () => {
    const { store, remove } = setup();
    expect(codeOf(await remove({ ...as("sofi"), memberId: "member-pedro" }))).toBe("InsufficientRole");
    expect(codeOf(await remove({ ...as("ana"), memberId: "member-luis" }))).toBe("NotAGuest");
    expect(store.left).toEqual([]);
  });

  it("reports unknown and malformed ids as MemberNotFound and hides the space from non-members", async () => {
    const { remove } = setup();
    for (const memberId of ["member-nobody", "not-a-uuid"]) {
      expect(codeOf(await remove({ ...as("ana"), memberId }))).toBe("MemberNotFound");
    }
    expect(codeOf(await remove({ ...as("marta"), memberId: "member-pedro" }))).toBe("SpaceNotFound");
  });

  it("revokes Pedro's pending claim links and nothing else (Review Focus 2)", async () => {
    const { invitations, remove } = setup();
    const link = unwrap(
      issueInvitation({
        id: "inv-link" as InvitationId,
        spaceId: space as SpaceId,
        target: { kind: "LINK" },
        role: "MEMBER",
        tokenHash: "hash(link)",
        createdBy: "u-ana",
        now,
      }),
    );
    invitations.rows = [
      claimFor("inv-pedro-1", "member-pedro"),
      claimFor("inv-pedro-2", "member-pedro"),
      claimFor("inv-other", "member-other"),
      link,
    ];
    unwrap(await remove({ ...as("luis"), memberId: "member-pedro" }));
    expect(invitations.rows.map((i) => [i.id, i.status, i.revokedAt])).toEqual([
      ["inv-pedro-1", "REVOKED", now],
      ["inv-pedro-2", "REVOKED", now],
      ["inv-other", "PENDING", null],
      ["inv-link", "PENDING", null],
    ]);
  });

  it("refuses removals in a personal space and in a direct space (D16)", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    const inPersonal = { spaceId: "space-ana", userId: "u-ana", memberId: "member-pedro" };
    expect(codeOf(await setup(personal).remove(inPersonal))).toBe("PersonalSpaceNotShareable");
    const direct: Space = {
      ...householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Pedro", null, 1)]),
      kind: "DIRECT",
      name: "Ana & Pedro",
    };
    expect(codeOf(await setup(direct).remove({ ...as("ana"), memberId: "member-pedro" }))).toBe(
      "DirectSpaceMembersFixed",
    );
  });

  it("acts on the authorized space id, never on the raw one of the request", async () => {
    const { store, invitations, deps } = setup();
    invitations.rows = [claimFor("inv-pedro", "member-pedro")];
    // The request spells the space differently; only the membership the access check returns is canonical.
    const remove = createRemoveGuestMember({
      ...deps,
      access: (id, userId) => deps.access(id.toLowerCase(), userId),
    });
    unwrap(await remove({ spaceId: "SPACE-HOUSEHOLD", userId: "u-luis", memberId: "member-pedro" }));
    expect(store.left).toEqual([{ spaceId: space, memberId: "member-pedro", leftAt: now }]);
    expect(invitations.rows.map((i) => i.status)).toEqual(["REVOKED"]);
  });

  it("answers NotAGuest when a concurrent claim made Pedro a registered member first", async () => {
    class RacingStore extends InMemorySpaceStore {
      override async markLeft(): Promise<boolean> {
        return false;
      }
    }
    const { remove } = setup(householdSpace(), {}, new RacingStore());
    expect(codeOf(await remove({ ...as("luis"), memberId: "member-pedro" }))).toBe("NotAGuest");
  });
});
