import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, unwrap } from "../../../../tests/support/fakes";
import {
  HOUSEHOLD_MEMBERS,
  householdSpace,
  InMemorySpaceStore,
  memberOf,
} from "../../../../tests/support/in-memory-spaces";
import {
  createPersonalSpace,
  type Space,
  type SpaceId,
  type SpaceMember,
  type SpaceMemberId,
} from "../domain/space";
import { createLeaveSpace } from "./leave-space";
import type { LifecycleDeps } from "./lifecycle-deps";
import { createSpaceAccess } from "./space-access";

const now = new Date("2026-10-14T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

/** Net balances of Household by member id (minor units); any other space answers 1, never settled. */
const nets =
  (byMember: Record<string, bigint> = {}): LifecycleDeps["netBalance"] =>
  async (spaceId, memberId) =>
    spaceId === space ? (byMember[memberId] ?? 0n) : 1n;

/** A store whose member was moved (claimed, removed or left) by a concurrent change after it was read. */
class LostRaceStore extends InMemorySpaceStore {
  override async markLeft(): Promise<boolean> {
    return false;
  }
}

// HU-E1-05 Background members: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const setup = (
  seeded: Space = householdSpace(),
  byMember: Record<string, bigint> = {},
  store: InMemorySpaceStore = new InMemorySpaceStore(),
) => {
  store.seed(seeded);
  const deps: LifecycleDeps = {
    access: createSpaceAccess(store),
    members: store,
    spaceLocks: store,
    netBalance: nets(byMember),
    clock: new FixedClock(now),
    tm: memoryTm,
  };
  return { store, leave: createLeaveSpace(deps) };
};
const idsOf = (members: readonly SpaceMember[]) => members.map((m) => m.id);

describe("LeaveSpace (HU-E1-08)", () => {
  it("lets Luis, whose balance is zero, leave: he is no longer a current member", async () => {
    const { store, leave } = setup();
    expect(unwrap(await leave(as("luis")))).toBeUndefined();
    expect(idsOf(store.members(space))).toEqual(["member-ana", "member-juan", "member-sofi", "member-pedro"]);
    expect(store.left).toEqual([{ spaceId: space, memberId: "member-luis", leftAt: now }]);
    expect(store.locked).toEqual([space]);
  });

  it("locks the space for a lifecycle change before it reads the balance (issue #89)", async () => {
    const { store, leave } = setup();
    unwrap(await leave(as("luis")));
    expect(store.locks.lifecycle).toEqual([space]);
  });

  it("takes no lock for a stranger, whose leave is refused before the space is touched (issue #89)", async () => {
    const { store, leave } = setup();
    expect(codeOf(await leave({ spaceId: space, userId: "u-nobody" }))).toBe("SpaceNotFound");
    expect(store.locks.lifecycle).toEqual([]);
  });

  it("refuses Juan while he owes Ana 150,000 COP, with the outstanding amount (Review Focus 1)", async () => {
    const { store, leave } = setup(householdSpace(), {
      "member-ana": 15_000_000n,
      "member-juan": -15_000_000n,
    });
    expect(await leave(as("juan"))).toEqual({
      ok: false,
      error: {
        code: "OutstandingBalance",
        details: { outstanding: { amount: "15000000", currency: "COP" } },
      },
    });
    expect(store.left).toEqual([]);
  });

  it("refuses Luis while the guest Pedro owes him 50,000 COP (Review Focus 1)", async () => {
    const { leave } = setup(householdSpace(), { "member-luis": 5_000_000n, "member-pedro": -5_000_000n });
    expect(await leave(as("luis"))).toEqual({
      ok: false,
      error: { code: "OutstandingBalance", details: { outstanding: { amount: "5000000", currency: "COP" } } },
    });
  });

  it("keeps the only OWNER, and lets an owner leave once another OWNER exists", async () => {
    expect(codeOf(await setup().leave(as("ana")))).toBe("LastOwnerRequired");
    const twoOwners = HOUSEHOLD_MEMBERS.map((m): SpaceMember =>
      m.displayName === "Juan" ? { ...m, role: "OWNER" } : m,
    );
    expect(codeOf(await setup(householdSpace(twoOwners)).leave(as("ana")))).toBe("ok");
  });

  it("lets a viewer leave (Review Focus 1)", async () => {
    const { store, leave } = setup();
    expect(codeOf(await leave(as("sofi")))).toBe("ok");
    expect(store.left.map((l) => l.memberId)).toEqual(["member-sofi"]);
  });

  it("refuses leaving a personal space or a direct space (D16)", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    expect(codeOf(await setup(personal).leave({ spaceId: "space-ana", userId: "u-ana" }))).toBe(
      "PersonalSpaceNotShareable",
    );
    const direct: Space = {
      ...householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Juan", "OWNER", 1)]),
      kind: "DIRECT",
      name: "Ana & Juan",
    };
    expect(codeOf(await setup(direct).leave(as("juan")))).toBe("DirectSpaceMembersFixed");
  });

  it("answers MemberNotFound when a concurrent change already moved the member, never ok", async () => {
    const { leave } = setup(householdSpace(), {}, new LostRaceStore());
    expect(await leave(as("luis"))).toEqual({ ok: false, error: { code: "MemberNotFound" } });
  });

  it("hides the space from non-members", async () => {
    expect(codeOf(await setup().leave(as("marta")))).toBe("SpaceNotFound");
  });
});
