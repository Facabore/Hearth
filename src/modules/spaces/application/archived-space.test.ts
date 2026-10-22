import { describe, expect, it } from "vitest";
import { FixedClock, type Result } from "@/shared/kernel";
import { codeOf, memoryTm, noStoredPeriods, sequentialIds, unwrap } from "../../../../tests/support/fakes";
import { invitationsWorld } from "../../../../tests/support/in-memory-spaces";
import { createAcceptInvitation } from "./accept-invitation";
import { createAddGuestMember } from "./add-guest-member";
import { createChangeMemberRole } from "./change-member-role";
import { createClaimGuestPlace } from "./claim-guest-place";
import { createCreateGuestClaim } from "./create-guest-claim";
import { createCreateInvitation } from "./create-invitation";
import { createGetSpace } from "./get-space";
import { createLeaveSpace } from "./leave-space";
import type { LifecycleDeps } from "./lifecycle-deps";
import { createListMembers } from "./list-members";
import { createListSpacePeriods } from "./list-space-periods";
import type { MembersDeps } from "./members-deps";
import { createRemoveGuestMember } from "./remove-guest-member";
import { createRevokeInvitation } from "./revoke-invitation";
import { createUpdateSpaceSettings } from "./update-space-settings";

const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

/**
 * Household (HU-E1-05 Background members) with one pending invitation (`id-1`, `token-1`) and one claim
 * link for the guest Pedro (`id-2`, `token-2`), both created while the space was active; archived or not.
 */
const world = async (archived: boolean) => {
  const w = invitationsWorld();
  const { store, deps, claims, clock, invitations } = w;
  const membersDeps: MembersDeps = {
    access: deps.access,
    members: store,
    ids: sequentialIds("member-new"),
    clock,
    tm: memoryTm,
  };
  const lifecycle: LifecycleDeps = {
    access: deps.access,
    members: store,
    spaceLocks: store,
    netBalance: async () => 0n,
    clock,
    tm: memoryTm,
  };
  unwrap(await createCreateInvitation(deps)({ ...as("ana"), role: "MEMBER", target: { kind: "LINK" } }));
  unwrap(await createCreateGuestClaim(claims)({ ...as("ana"), memberId: "member-pedro" }));
  if (archived) store.archived.add(space);
  return {
    store,
    invitations,
    updateSettings: createUpdateSpaceSettings({
      spaces: store,
      access: deps.access,
      usage: { hasMoneyRecords: async () => false },
      tm: memoryTm,
    }),
    createInvitation: createCreateInvitation(deps),
    revokeInvitation: createRevokeInvitation(deps),
    acceptInvitation: createAcceptInvitation(deps),
    createGuestClaim: createCreateGuestClaim(claims),
    claimGuestPlace: createClaimGuestPlace(claims),
    addGuest: createAddGuestMember(membersDeps),
    changeRole: createChangeMemberRole(membersDeps),
    leave: createLeaveSpace(lifecycle),
    removeGuest: createRemoveGuestMember({ ...lifecycle, invitations }),
    getSpace: createGetSpace(deps.access),
    listMembers: createListMembers(membersDeps),
    listPeriods: createListSpacePeriods({
      access: deps.access,
      storedPeriods: noStoredPeriods,
      clock: new FixedClock(new Date("2026-10-28T15:00:00Z")),
      timeZone: "America/Bogota",
    }),
  };
};
type World = Awaited<ReturnType<typeof world>>;

/** What a refused write must not have touched: members, roles, invitations, leaves and claims. */
const stateOf = (w: World) => ({
  members: w.store.members(space).map((m) => [m.id, m.role]),
  invitations: w.invitations.rows,
  left: w.store.left,
  claimed: w.store.claimed,
});

// Joining happens before AcceptInvitation and ClaimGuestPlace read the space back through SpaceAccess, so
// their SpaceArchived undoes the join in a real transaction (Task 18b pins it over HTTP).
const WRITES: readonly (readonly [string, (w: World) => Promise<Result<unknown>>, boolean])[] = [
  ["UpdateSpaceSettings", (w) => w.updateSettings({ ...as("ana"), changes: { name: "Casa" } }), true],
  [
    "CreateInvitation",
    (w) => w.createInvitation({ ...as("ana"), role: "MEMBER", target: { kind: "LINK" } }),
    true,
  ],
  ["RevokeInvitation", (w) => w.revokeInvitation({ ...as("ana"), invitationId: "id-1" }), true],
  [
    "AcceptInvitation",
    (w) =>
      w.acceptInvitation({
        token: "token-1",
        userId: "u-marta",
        userEmail: "marta@example.com",
        userName: "Marta",
      }),
    false,
  ],
  ["CreateGuestClaim", (w) => w.createGuestClaim({ ...as("ana"), memberId: "member-pedro" }), true],
  ["ClaimGuestPlace", (w) => w.claimGuestPlace({ token: "token-2", userId: "u-marta" }), false],
  ["AddGuestMember", (w) => w.addGuest({ ...as("luis"), displayName: "Camila" }), true],
  ["ChangeMemberRole", (w) => w.changeRole({ ...as("ana"), memberId: "member-luis", role: "ADMIN" }), true],
  ["LeaveSpace", (w) => w.leave(as("luis")), true],
  ["RemoveGuestMember", (w) => w.removeGuest({ ...as("luis"), memberId: "member-pedro" }), true],
];

describe("archived spaces only read: spaces write use cases (HU-E1-09, Review Focus 4)", () => {
  it.each(WRITES)(
    "%s answers SpaceArchived, where an active space accepts it",
    async (_name, write, pure) => {
      expect(codeOf(await write(await world(false)))).toBe("ok");
      const archived = await world(true);
      const before = stateOf(archived);
      expect(codeOf(await write(archived))).toBe("SpaceArchived");
      if (pure) expect(stateOf(archived)).toEqual(before);
    },
  );

  it("still lets every role read the space, its members and its periods", async () => {
    const w = await world(true);
    for (const name of ["ana", "juan", "luis", "sofi"]) {
      expect(unwrap(await w.getSpace(as(name)))).toMatchObject({ id: space, name: "Household" });
      expect(unwrap(await w.listMembers(as(name)))).toHaveLength(5);
      expect(unwrap(await w.listPeriods({ ...as(name), count: 1 }))).toHaveLength(1);
    }
  });

  it("keeps hiding an archived space from non-members, for reads and writes alike", async () => {
    const w = await world(true);
    expect(codeOf(await w.getSpace(as("marta")))).toBe("SpaceNotFound");
    expect(codeOf(await w.listMembers(as("marta")))).toBe("SpaceNotFound");
    expect(codeOf(await w.addGuest({ ...as("marta"), displayName: "Camila" }))).toBe("SpaceNotFound");
  });
});
