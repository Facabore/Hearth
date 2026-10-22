import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
import { codeOf, memoryTm, unwrap } from "../../../../tests/support/fakes";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createPersonalSpace, type Space, type SpaceId, type SpaceMemberId } from "../domain/space";
import { createArchiveSpace } from "./archive-space";
import { createListMySpaces } from "./list-my-spaces";
import { createSpaceAccess } from "./space-access";

const now = new Date("2026-10-14T12:00:00Z");
const space = "space-household";
const as = (name: string) => ({ spaceId: space, userId: `u-${name}` });

// HU-E1-05 Background members: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const setup = (seeded: Space = householdSpace(), byMember: Record<string, bigint> = {}) => {
  const store = new InMemorySpaceStore();
  store.seed(seeded);
  const asked: { spaceId: string; memberIds: readonly string[] }[] = [];
  const archive = createArchiveSpace({
    access: createSpaceAccess(store),
    members: store,
    spaceLocks: store,
    spaces: store,
    // Nets of Household by member id; any other space answers 1 for everyone, never settled.
    netBalances: async (spaceId, memberIds) => {
      asked.push({ spaceId, memberIds });
      return memberIds.map((id) => (spaceId === space ? (byMember[id] ?? 0n) : 1n));
    },
    clock: new FixedClock(now),
    tm: memoryTm,
  });
  return { store, asked, archive, listMine: createListMySpaces(store) };
};

describe("ArchiveSpace (HU-E1-09)", () => {
  it("locks the space for a lifecycle change before it reads the nets (issue #89)", async () => {
    const { store, archive } = setup();
    unwrap(await archive(as("ana")));
    expect(store.locks.lifecycle).toEqual([space]);
  });

  it("takes no lock when the requester may not archive (issue #89)", async () => {
    const { store, archive } = setup();
    expect(codeOf(await archive(as("luis")))).toBe("InsufficientRole");
    expect(store.locks.lifecycle).toEqual([]);
  });

  it("archives a space whose members, the guest Pedro included, are settled, and lists it only on request", async () => {
    const { store, asked, archive, listMine } = setup();
    expect(unwrap(await archive(as("ana")))).toBeUndefined();
    expect(store.archived.has(space)).toBe(true);
    expect(unwrap(await listMine("u-ana")).map((s) => s.id)).toEqual([]);
    expect(unwrap(await listMine("u-ana", { includeArchived: true })).map((s) => s.id)).toEqual([space]);
    // One read of the nets, for every current member in join order, the guest Pedro last.
    expect(asked).toEqual([
      {
        spaceId: space,
        memberIds: ["member-ana", "member-juan", "member-luis", "member-sofi", "member-pedro"],
      },
    ]);
    // Members are read plainly, like RemoveGuestMember: FOR UPDATE would conflict with the key-share locks that
    // money writes take on member rows, a deadlock risk that archiving, which changes no member, does not need.
    expect(store.locked).toEqual([]);
  });

  it("refuses while Juan owes Ana 150,000 COP, with the outstanding amount", async () => {
    const { store, archive } = setup(householdSpace(), {
      "member-ana": 15_000_000n,
      "member-juan": -15_000_000n,
    });
    expect(await archive(as("ana"))).toEqual({
      ok: false,
      error: {
        code: "OutstandingBalance",
        details: { outstanding: { amount: "15000000", currency: "COP" } },
      },
    });
    expect(store.archived.size).toBe(0);
  });

  it("refuses while only the guest Pedro owes Ana 100,000 COP (Review Focus 1)", async () => {
    const { store, archive } = setup(householdSpace(), {
      "member-ana": 10_000_000n,
      "member-pedro": -10_000_000n,
    });
    expect(await archive(as("ana"))).toEqual({
      ok: false,
      error: {
        code: "OutstandingBalance",
        details: { outstanding: { amount: "10000000", currency: "COP" } },
      },
    });
    expect(store.archived.size).toBe(0);
  });

  it("counts the net of the guest Pedro on its own, whatever the other members hold", async () => {
    // Nets of a real space add up to zero, so a debtor's creditor blocks too; the guest's own net must still count.
    const { store, archive } = setup(householdSpace(), { "member-pedro": -10_000_000n });
    expect(await archive(as("ana"))).toEqual({
      ok: false,
      error: {
        code: "OutstandingBalance",
        details: { outstanding: { amount: "10000000", currency: "COP" } },
      },
    });
    expect(store.archived.size).toBe(0);
  });

  it("lets only the OWNER archive and hides the space from non-members", async () => {
    const { store, archive } = setup();
    expect(codeOf(await archive(as("juan")))).toBe("InsufficientRole");
    expect(codeOf(await archive(as("marta")))).toBe("SpaceNotFound");
    expect(store.archived.size).toBe(0);
  });

  it("never archives a personal space, and archives a settled direct space", async () => {
    const personal = createPersonalSpace({
      id: "space-ana" as SpaceId,
      memberId: "member-ana-personal" as SpaceMemberId,
      ownerUserId: "u-ana",
      ownerName: "Ana",
      now,
    });
    const refused = setup(personal);
    expect(codeOf(await refused.archive({ spaceId: "space-ana", userId: "u-ana" }))).toBe(
      "PersonalSpaceNotArchivable",
    );
    // Refused before any balance is read or anything is written.
    expect(refused.asked).toEqual([]);
    expect(refused.store.archived.size).toBe(0);
    const direct: Space = {
      ...householdSpace([memberOf("Ana", "OWNER", 0), memberOf("Pedro", null, 1)]),
      kind: "DIRECT",
      name: "Ana & Pedro",
    };
    const settled = setup(direct);
    expect(codeOf(await settled.archive(as("ana")))).toBe("ok");
    expect(settled.store.archived.has(space)).toBe(true);
  });

  it("answers SpaceArchived when the space is archived already", async () => {
    const { archive } = setup();
    unwrap(await archive(as("ana")));
    expect(codeOf(await archive(as("ana")))).toBe("SpaceArchived");
  });

  it("lists neither active nor archived spaces the user left", async () => {
    const { store, archive, listMine } = setup();
    await store.markLeft(space, "member-luis", "USER", now);
    expect(unwrap(await listMine("u-luis"))).toEqual([]);
    expect(unwrap(await listMine("u-luis", { includeArchived: true }))).toEqual([]);
    unwrap(await archive(as("ana")));
    expect(unwrap(await listMine("u-luis", { includeArchived: true }))).toEqual([]);
    expect(unwrap(await listMine("u-ana", { includeArchived: true })).map((s) => s.id)).toEqual([space]);
  });
});
