import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { FixedClock, ok } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture, sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import { createChangeMemberRole } from "../application/change-member-role";
import { createLeaveSpace } from "../application/leave-space";
import { createSpaceAccess } from "../application/space-access";
import type { GuestClaimRepository, MemberLifecycleRepository } from "../application/space-member-repository";
import type { SpaceId, SpaceMember, SpaceMemberId, SpaceRole } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleSpaceRepository(tm);

const newUser = async (name: string): Promise<string> => (await userFixture(pool, name)).id;
/** "Household" created at 12:00Z through `DrizzleSpaceRepository.add`, so guests (13:00Z) and users (14:00Z) join after Ana. */
const household = (ownerId: string) => sharedSpaceFixture(db, ownerId, new Date("2026-10-13T12:00:00Z"));
const guest = (displayName: string, contactEmail: string | null = null): SpaceMember => ({
  id: randomUUID() as SpaceMemberId,
  kind: "GUEST",
  userId: null,
  displayName,
  role: null,
  contactEmail,
  joinedAt: new Date("2026-10-13T13:00:00Z"),
});
const registered = (userId: string, displayName: string, role: SpaceRole = "MEMBER"): SpaceMember => ({
  id: randomUUID() as SpaceMemberId,
  kind: "USER",
  userId,
  displayName,
  role,
  contactEmail: null,
  joinedAt: new Date("2026-10-13T14:00:00Z"),
});
const leave = (memberId: string) =>
  pool.query("UPDATE space_members SET left_at = now() WHERE id = $1", [memberId]);
const count = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0].n as number;

afterAll(() => pool.end());

describe("DrizzleSpaceRepository members (HU-E1-04, HU-E1-10)", () => {
  it("persists a shared space with its creator as the only OWNER", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana);
    expect(await repo.listForUser(ana)).toEqual([
      {
        id: space.id,
        name: "Household",
        kind: "SHARED",
        currency: "COP",
        periodPolicy: { kind: "MONTHLY", day: 1 },
        role: "OWNER",
      },
    ]);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
  });

  it("adds a guest with a contact email and lists current members in join order", async () => {
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro", "pedro@example.com");
    expect(await repo.addMember(space.id, pedro)).toBe("added");
    expect(await repo.listCurrent(space.id)).toEqual([...space.members, pedro]);
  });

  it("reports a name taken in any case and a user who is already a current member", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana);
    await repo.addMember(space.id, guest("Pedro"));
    expect(await repo.addMember(space.id, guest("PEDRO"))).toBe("nameTaken");
    expect(await repo.addMember(space.id, registered(ana, "Ana Again"))).toBe("alreadyMember");
    expect(await repo.listCurrent(space.id)).toHaveLength(2);
  });

  it("reports a conflict as a result, so the surrounding transaction stays usable", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    await repo.addMember(space.id, guest("Pedro"));
    const outcome = await tm.run(async () => {
      const taken = await repo.addMember(space.id, guest("pedro"));
      const already = await repo.addMember(space.id, registered(ana, "Ana Again"));
      // A thrown unique violation would have aborted the transaction and failed this insert.
      const retried = await repo.addMember(space.id, registered(juan, "Juan"));
      return ok({ taken, already, retried });
    });
    expect(outcome).toEqual({
      ok: true,
      value: { taken: "nameTaken", already: "alreadyMember", retried: "added" },
    });
    expect(await repo.listCurrent(space.id)).toHaveLength(3);
  });

  it("frees the name and lets a former member join again with a new row (HU-E1-07)", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    const pedro = guest("Pedro");
    const juanBefore = registered(juan, "Juan");
    await repo.addMember(space.id, pedro);
    await repo.addMember(space.id, juanBefore);
    await leave(pedro.id);
    await leave(juanBefore.id);
    expect(await repo.addMember(space.id, guest("Pedro"))).toBe("added");
    expect(await repo.addMember(space.id, registered(juan, "Juan"))).toBe("added");
    const rows = "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND user_id = $2";
    expect(await count(rows, [space.id, juan])).toBe(2);
  });

  it("changes a member's role", async () => {
    const juan = await newUser("Juan");
    const space = await household(await newUser("Ana"));
    const member = registered(juan, "Juan");
    await repo.addMember(space.id, member);
    await repo.updateRole(space.id, member.id, "ADMIN");
    expect((await repo.findMembership(space.id, juan))?.role).toBe("ADMIN");
  });

  it("returns no members for a malformed space id and locks rows inside a transaction", async () => {
    const space = await household(await newUser("Ana"));
    expect(await repo.listCurrent("not-a-uuid" as SpaceId)).toEqual([]);
    expect(await tm.run(async () => ok(await repo.listCurrent(space.id, { lock: true })))).toEqual({
      ok: true,
      value: space.members,
    });
  });
});

describe("concurrent member changes (Review Focus 3)", () => {
  it("lets exactly one of two concurrent guests with the same name in", async () => {
    const space = await household(await newUser("Ana"));
    const add = (name: string) => tm.run(async () => ok(await repo.addMember(space.id, guest(name))));
    const outcomes = await Promise.all([add("Pedro"), add("pedro")]);
    expect(outcomes.map((o) => (o.ok ? o.value : o.error.code)).sort()).toEqual(["added", "nameTaken"]);
  });

  it("keeps exactly one OWNER when two owners demote each other at the same time", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    const juanOwner = registered(juan, "Juan", "OWNER");
    await repo.addMember(space.id, juanOwner);
    const changeRole = createChangeMemberRole({ access: createSpaceAccess(repo), members: repo, tm });
    const results = await Promise.all([
      changeRole({ spaceId: space.id, userId: ana, memberId: juanOwner.id, role: "ADMIN" }),
      changeRole({ spaceId: space.id, userId: juan, memberId: space.members[0]!.id, role: "ADMIN" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // The loser re-reads its role on the locked rows, sees itself demoted, and is refused for that.
    expect(results.flatMap((r) => (r.ok ? [] : [r.error.code]))).toEqual(["InsufficientRole"]);
    const owners = "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND role = 'OWNER'";
    expect(await count(owners, [space.id])).toBe(1);
  });
});

describe("leaving and removal (HU-E1-08, HU-E1-12)", () => {
  const lifecycle: MemberLifecycleRepository = repo;
  const at = new Date("2026-10-14T12:00:00Z");

  it("sets leftAt on a current member of the given kind only, and keeps the row", async () => {
    const juan = await newUser("Juan");
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro");
    const juanMember = registered(juan, "Juan");
    await repo.addMember(space.id, pedro);
    await repo.addMember(space.id, juanMember);
    expect(await lifecycle.markLeft(space.id, pedro.id, "USER", at)).toBe(false);
    expect(await lifecycle.markLeft(space.id, juanMember.id, "GUEST", at)).toBe(false);
    expect(await lifecycle.markLeft(space.id, pedro.id, "GUEST", at)).toBe(true);
    expect(await lifecycle.markLeft(space.id, juanMember.id, "USER", at)).toBe(true);
    expect(await lifecycle.markLeft(space.id, juanMember.id, "USER", at)).toBe(false);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
    const { rows } = await pool.query(
      "SELECT id, left_at FROM space_members WHERE id = ANY($1) ORDER BY display_name",
      [[pedro.id, juanMember.id]],
    );
    expect(rows).toEqual([
      { id: juanMember.id, left_at: at },
      { id: pedro.id, left_at: at },
    ]);
  });

  it("finds no membership and lists no space for a member who left", async () => {
    const juan = await newUser("Juan");
    const space = await household(await newUser("Ana"));
    const member = registered(juan, "Juan");
    await repo.addMember(space.id, member);
    await lifecycle.markLeft(space.id, member.id, "USER", at);
    expect(await repo.findMembership(space.id, juan)).toBeNull();
    expect(await repo.listForUser(juan)).toEqual([]);
  });

  it("lets a user who left through markLeft join again with a new row, keeping the old one (HU-E1-07)", async () => {
    const juan = await newUser("Juan");
    const space = await household(await newUser("Ana"));
    const before = registered(juan, "Juan");
    await repo.addMember(space.id, before);
    expect(await lifecycle.markLeft(space.id, before.id, "USER", at)).toBe(true);
    const after = registered(juan, "Juan");
    // Same user and same name: both partial unique indexes must have freed their slot.
    expect(await repo.addMember(space.id, after)).toBe("added");
    expect((await repo.listCurrent(space.id)).filter((m) => m.userId === juan)).toEqual([after]);
    const current =
      "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND user_id = $2 AND left_at IS NULL";
    expect(await count(current, [space.id, juan])).toBe(1);
    const old = await pool.query("SELECT left_at FROM space_members WHERE id = $1", [before.id]);
    expect(old.rows).toEqual([{ left_at: at }]);
  });

  it("answers false for malformed ids and for members of another space", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana);
    const other = await household(ana);
    expect(await lifecycle.markLeft(space.id, "not-a-uuid" as SpaceMemberId, "USER", at)).toBe(false);
    expect(await lifecycle.markLeft(other.id, space.members[0]!.id, "USER", at)).toBe(false);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
  });

  it("gives the outcomes of the in-memory twin the use-case tests rely on", async () => {
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro");
    await repo.addMember(space.id, pedro);
    const twin = new InMemorySpaceStore();
    twin.seed({ ...space, members: [...space.members, pedro] });
    const steps = async (store: MemberLifecycleRepository) => [
      await store.markLeft(space.id, pedro.id, "USER", at),
      await store.markLeft(space.id, pedro.id, "GUEST", at),
      await store.markLeft(space.id, pedro.id, "GUEST", at),
      await store.markLeft(space.id, space.members[0]!.id, "USER", at),
    ];
    const outcomes = await steps(lifecycle);
    expect(outcomes).toEqual([false, true, false, true]);
    expect(await steps(twin)).toEqual(outcomes);
  });
});

/**
 * A balance port that answers 0 once `parties` callers arrived or `ms` passed. Without the row lock both
 * leavers reach it together and both leave; with it, the second waits on the locked rows and never arrives.
 */
const rendezvous = (parties: number, ms: number) => {
  let arrived = 0;
  let release: () => void = () => undefined;
  const everyone = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async (): Promise<bigint> => {
    arrived += 1;
    if (arrived >= parties) release();
    await Promise.race([everyone, new Promise((resolve) => setTimeout(resolve, ms))]);
    return 0n;
  };
};

describe("concurrent leaving (Review Focus 5)", () => {
  it("keeps exactly one OWNER when two owners leave at the same time", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    await repo.addMember(space.id, registered(juan, "Juan", "OWNER"));
    const leave = createLeaveSpace({
      access: createSpaceAccess(repo),
      members: repo,
      netBalance: rendezvous(2, 2_000),
      clock: new FixedClock(new Date("2026-10-14T12:00:00Z")),
      tm,
    });
    const results = await Promise.all([
      leave({ spaceId: space.id, userId: ana }),
      leave({ spaceId: space.id, userId: juan }),
    ]);
    // The second leaver reads the locked rows only after the first left, so it is the last OWNER.
    expect(results.map((r) => (r.ok ? "ok" : r.error.code)).sort()).toEqual(["LastOwnerRequired", "ok"]);
    const owners =
      "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND role = 'OWNER' AND left_at IS NULL";
    expect(await count(owners, [space.id])).toBe(1);
  });
});

describe("claiming guest places (HU-E1-11, Review Focus 2)", () => {
  const claims: GuestClaimRepository = repo;
  const at = new Date("2026-10-14T12:00:00Z");
  const claimedBy = (pedro: SpaceMember, userId: string, role: SpaceRole = "MEMBER"): SpaceMember => ({
    ...pedro,
    kind: "USER",
    userId,
    role,
    contactEmail: null,
  });

  it("turns the current guest into the registered member, same id, and records claimedAt", async () => {
    const pedroUser = await newUser("Pedro");
    const space = await household(await newUser("Ana"));
    const pedro = guest("Pedro", "pedro@example.com");
    await repo.addMember(space.id, pedro);
    expect(await claims.claimGuest(space.id, claimedBy(pedro, pedroUser), at)).toBe("claimed");
    expect(await repo.listCurrent(space.id)).toEqual([...space.members, claimedBy(pedro, pedroUser)]);
    const { rows } = await pool.query("SELECT claimed_at FROM space_members WHERE id = $1", [pedro.id]);
    expect(rows[0].claimed_at).toEqual(at);
    expect(await claims.spaceKindOf(space.id)).toBe("SHARED");
  });

  it("writes the role it is given, since the domain decides it (D16 makes a direct-space claimant OWNER)", async () => {
    const lauraUser = await newUser("Laura");
    const space = await household(await newUser("Ana"));
    const laura = guest("Laura");
    await repo.addMember(space.id, laura);
    expect(await claims.claimGuest(space.id, claimedBy(laura, lauraUser, "OWNER"), at)).toBe("claimed");
    expect((await repo.findMembership(space.id, lauraUser))?.role).toBe("OWNER");
  });

  it("answers notAGuest for removed, claimed or malformed guests and alreadyMember for a current user", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const pedroUser = await newUser("Pedro");
    const space = await household(ana);
    const pedro = guest("Pedro");
    const removed = guest("Removed");
    await repo.addMember(space.id, pedro);
    await repo.addMember(space.id, removed);
    await repo.markLeft(space.id, removed.id, "GUEST", at);
    expect(await claims.claimGuest(space.id, claimedBy(removed, pedroUser), at)).toBe("notAGuest");
    expect(await claims.claimGuest(space.id, claimedBy(pedro, ana), at)).toBe("alreadyMember");
    expect(await claims.claimGuest(space.id, claimedBy(pedro, pedroUser), at)).toBe("claimed");
    expect(await claims.claimGuest(space.id, claimedBy(pedro, juan), at)).toBe("notAGuest");
    const malformed = { ...claimedBy(pedro, juan), id: "not-a-uuid" as SpaceMemberId };
    expect(await claims.claimGuest(space.id, malformed, at)).toBe("notAGuest");
    expect((await repo.listCurrent(space.id)).map((m) => [m.displayName, m.userId])).toEqual([
      ["Ana", ana],
      ["Pedro", pedroUser],
    ]);
  });

  it("never claims a registered member or a guest of another space", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const space = await household(ana);
    const other = await household(ana);
    const pedro = guest("Pedro");
    await repo.addMember(other.id, pedro);
    const member = registered(juan, "Juan");
    await repo.addMember(space.id, member);
    expect(await claims.claimGuest(space.id, claimedBy(pedro, await newUser("Marta")), at)).toBe("notAGuest");
    expect(await claims.claimGuest(space.id, claimedBy(member, await newUser("Marta")), at)).toBe(
      "notAGuest",
    );
    expect(await repo.listCurrent(other.id)).toEqual([...other.members, pedro]);
    expect(await repo.listCurrent(space.id)).toEqual([...space.members, member]);
  });

  it("reports alreadyMember before notAGuest when both hold, the order ClaimGuestPlace expects", async () => {
    const ana = await newUser("Ana");
    const space = await household(ana);
    const removed = guest("Removed");
    await repo.addMember(space.id, removed);
    await repo.markLeft(space.id, removed.id, "GUEST", at);
    // Ana is a current member and the guest is gone: her membership is what gets reported.
    expect(await claims.claimGuest(space.id, claimedBy(removed, ana), at)).toBe("alreadyMember");
    const malformed = { ...claimedBy(removed, ana), id: "not-a-uuid" as SpaceMemberId };
    expect(await claims.claimGuest(space.id, malformed, at)).toBe("alreadyMember");
  });

  it("reads the kind of the space and refuses one that does not exist", async () => {
    const personal = await personalSpaceFixture(db, pool);
    expect(await claims.spaceKindOf(personal.spaceId as SpaceId)).toBe("PERSONAL");
    await expect(claims.spaceKindOf(randomUUID() as SpaceId)).rejects.toThrow(/does not exist/);
  });

  it("gives the outcomes of the in-memory twin the use-case tests rely on", async () => {
    const ana = await newUser("Ana");
    const juan = await newUser("Juan");
    const pedroUser = await newUser("Pedro");
    const space = await household(ana);
    const pedro = guest("Pedro");
    await repo.addMember(space.id, pedro);
    const twin = new InMemorySpaceStore();
    twin.seed({ ...space, members: [...space.members, pedro] });
    const malformed = (userId: string) => ({
      ...claimedBy(pedro, userId),
      id: "not-a-uuid" as SpaceMemberId,
    });
    const steps = async (store: GuestClaimRepository) => [
      await store.claimGuest(space.id, claimedBy(pedro, ana), at),
      await store.claimGuest(space.id, claimedBy(pedro, pedroUser), at),
      // No longer a guest and already a member: the membership is reported first.
      await store.claimGuest(space.id, claimedBy(pedro, pedroUser), at),
      await store.claimGuest(space.id, claimedBy(pedro, juan), at),
      await store.claimGuest(space.id, malformed(juan), at),
      await store.claimGuest(space.id, malformed(ana), at),
    ];
    const outcomes = await steps(claims);
    expect(outcomes).toEqual([
      "alreadyMember",
      "claimed",
      "alreadyMember",
      "notAGuest",
      "notAGuest",
      "alreadyMember",
    ]);
    expect(await steps(twin)).toEqual(outcomes);
    expect(await twin.spaceKindOf(space.id)).toBe(await claims.spaceKindOf(space.id));
  });
});
