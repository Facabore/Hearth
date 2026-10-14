import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, describe, expect, it } from "vitest";
import { createSeedDefaultCategories } from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { SystemClock } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import type { DirectSpaceRepository } from "../application/direct-space-repository";
import { createSpaceAccess } from "../application/space-access";
import {
  createSplitWithPerson,
  type DirectExpenseRecorder,
  type DirectSplitCounterpart,
} from "../application/split-with-person";
import { createDirectSpace, pairKeyOf, type DirectCounterpart } from "../domain/direct-space";
import type { Space, SpaceMember, SpaceMemberId } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const repo = new DrizzleSpaceRepository(tm);
const direct: DirectSpaceRepository = repo;

const directSpace = (creator: { id: string; name: string }, counterpart: DirectCounterpart): Space => {
  // Both members join at the same instant and are listed by id then: the creator's sorts first, as the
  // use case's sequentially generated ids make it.
  const [creatorMemberId, counterpartMemberId] = [randomUUID(), randomUUID()].sort() as Id<"SpaceMember">[];
  return unwrap(
    createDirectSpace({
      id: randomUUID() as Id<"Space">,
      creatorMemberId: creatorMemberId!,
      counterpartMemberId: counterpartMemberId!,
      creatorUserId: creator.id,
      creatorName: creator.name,
      counterpart,
      currency: "COP",
      now: new Date("2026-10-14T12:00:00Z"),
    }),
  );
};
const pair = async () => ({ ana: await userFixture(pool, "Ana"), juan: await userFixture(pool, "Juan") });
const withUser = (user: { id: string; name: string }): DirectCounterpart => ({
  kind: "USER",
  userId: user.id,
  displayName: user.name,
});
const count = async (sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0].n as number;

afterAll(() => pool.end());

describe("DrizzleSpaceRepository direct spaces (HU-E1-13)", () => {
  it("stores a direct space between two users with both members, found by its pair in either order", async () => {
    const { ana, juan } = await pair();
    const space = directSpace(ana, withUser(juan));
    expect(await direct.addDirect(space)).toBe(space.id);
    expect(await direct.findByPairKey(pairKeyOf(juan.id, ana.id))).toBe(space.id);
    expect(await repo.listCurrent(space.id)).toEqual(space.members);
    expect(await repo.findMembership(space.id, juan.id)).toMatchObject({
      spaceKind: "DIRECT",
      name: "Ana & Juan",
      role: "OWNER",
    });
  });

  it("stores a guest's direct space under no pair and finds the guest as a current member of it", async () => {
    const { ana } = await pair();
    const space = directSpace(ana, { kind: "GUEST", displayName: "Pedro", contactEmail: null });
    expect(await direct.addDirect(space)).toBe(space.id);
    const { rows } = await pool.query("SELECT direct_pair_key FROM spaces WHERE id = $1", [space.id]);
    expect(rows[0].direct_pair_key).toBeNull();
    expect(await direct.findCurrentMember(space.members[1]!.id)).toEqual({
      spaceId: space.id,
      spaceKind: "DIRECT",
      member: space.members[1],
    });
  });

  it("answers a second space of the same pair with the first one's id and adds nothing", async () => {
    const { ana, juan } = await pair();
    const first = directSpace(ana, withUser(juan));
    const second = directSpace(juan, withUser(ana));
    await direct.addDirect(first);
    expect(await direct.addDirect(second)).toBe(first.id);
    expect(await count("SELECT count(*)::int AS n FROM spaces WHERE id = $1", [second.id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [second.id])).toBe(
      0,
    );
  });

  it("lets an archived direct space go, so the pair can start a new one", async () => {
    const { ana, juan } = await pair();
    const old = directSpace(ana, withUser(juan));
    await direct.addDirect(old);
    await pool.query("UPDATE spaces SET archived_at = now() WHERE id = $1", [old.id]);
    expect(await direct.findByPairKey(pairKeyOf(ana.id, juan.id))).toBeNull();
    const fresh = directSpace(ana, withUser(juan));
    expect(await direct.addDirect(fresh)).toBe(fresh.id);
  });

  it("finds no member for malformed, unknown or former ids (Review Focus 3)", async () => {
    const space = await sharedSpaceFixture(db, (await userFixture(pool, "Ana")).id);
    const owner = space.members[0]!;
    expect(await direct.findCurrentMember(owner.id)).toEqual({
      spaceId: space.id,
      spaceKind: "SHARED",
      member: owner,
    });
    expect(await direct.findCurrentMember("not-a-uuid")).toBeNull();
    expect(await direct.findCurrentMember(randomUUID())).toBeNull();
    await pool.query("UPDATE space_members SET left_at = now() WHERE id = $1", [owner.id]);
    expect(await direct.findCurrentMember(owner.id)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["a number", "123"],
    ["SQL text", "'; DROP TABLE spaces; --"],
    ["a UUID with a trailing character", `${randomUUID()}x`],
    ["a UUID with a leading space", ` ${randomUUID()}`],
    ["a UUID with a trailing newline", `${randomUUID()}\n`],
  ])("answers null, not a database error, for a member id that is %s", async (_shape, memberId) => {
    expect(await direct.findCurrentMember(memberId)).toBeNull();
  });

  it("finds a current member by an upper-case id", async () => {
    const space = await sharedSpaceFixture(db, (await userFixture(pool, "Ana")).id);
    const owner = space.members[0]!;
    expect(await direct.findCurrentMember(owner.id.toUpperCase())).toMatchObject({ member: owner });
  });

  it.each(["", "not-a-pair", "'; DROP TABLE spaces; --", `${randomUUID()}:${randomUUID()}`])(
    "finds no space under the key %j",
    async (pairKey) => {
      expect(await direct.findByPairKey(pairKey)).toBeNull();
    },
  );

  it("refuses to guess when a conflicting insert leaves no active pair behind", async () => {
    const { ana } = await pair();
    const space = directSpace(ana, { kind: "GUEST", displayName: "Pedro", contactEmail: null });
    await direct.addDirect(space);
    await expect(direct.addDirect(space)).rejects.toThrow(/conflicts with no active pair/);
    expect(await count("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [space.id])).toBe(
      2,
    );
  });
});

/** Resolves once another connection is blocked inside an insert of a space: the loser waiting for the winner. */
const untilAnInsertWaitsForAnotherTransaction = async (): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE 'insert into "spaces"%'`,
    );
    if (rowCount) return;
    await sleep(25);
  }
  throw new Error("no insert of a space ever waited for another transaction");
};

describe("concurrent first splits (Review Focus 5)", () => {
  it("lets one of two simultaneous first splits of a pair create the space and gives both its id", async () => {
    const { ana, juan } = await pair();
    const byAna = directSpace(ana, withUser(juan));
    const byJuan = directSpace(juan, withUser(ana));
    const results = await Promise.all(
      [byAna, byJuan].map((space) => tm.run(async () => ok(await direct.addDirect(space)))),
    );
    const winners = results.map((r) => (r.ok ? r.value : null));
    expect(new Set(winners).size).toBe(1);
    expect([byAna.id, byJuan.id]).toContain(winners[0]);
    const active = "SELECT count(*)::int AS n FROM spaces WHERE direct_pair_key = $1";
    expect(await count(active, [pairKeyOf(ana.id, juan.id)])).toBe(1);
  });

  it("makes the losing insert wait for the winner's open transaction and then reuse the winner's space", async () => {
    const { ana, juan } = await pair();
    const byAna = directSpace(ana, withUser(juan));
    const byJuan = directSpace(juan, withUser(ana));
    let winnerInserted!: () => void;
    const inserted = new Promise<void>((resolve) => (winnerInserted = resolve));
    let commit!: () => void;
    const mayCommit = new Promise<void>((resolve) => (commit = resolve));
    const winner = tm.run(async () => {
      const id = await direct.addDirect(byAna);
      winnerInserted();
      await mayCommit;
      return ok(id);
    });
    // A winner that fails before inserting surfaces here instead of hanging the test.
    await Promise.race([inserted, winner]);
    // Started outside the winner's transaction, so it runs in its own.
    const loser = tm.run(async () => ok(await direct.addDirect(byJuan)));
    try {
      await untilAnInsertWaitsForAnotherTransaction();
    } finally {
      // Even when nothing waited, the winner's transaction must not stay open.
      commit();
    }
    expect(unwrap(await winner)).toBe(byAna.id);
    expect(unwrap(await loser)).toBe(byAna.id);
    expect(await count("SELECT count(*)::int AS n FROM spaces WHERE id = $1", [byJuan.id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [byJuan.id])).toBe(
      0,
    );
    expect(await count("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [byAna.id])).toBe(
      2,
    );
  });
});

type Recorder = DirectExpenseRecorder<string, string>;
type Registered = { id: string; name: string };

const categoryRepo = new DrizzleCategoryRepository(tm);
const ids = new UuidV7IdGenerator();
const clock = new SystemClock();
const seedDefaultCategories = createSeedDefaultCategories({ categories: categoryRepo, ids, clock, tm });

/** SplitWithPerson over the real repositories; `afterSeeding` is one more step of the new space's seeding. */
const splitWith = (
  recordExpense: Recorder,
  afterSeeding: (spaceId: string) => Promise<Result<void>> = async () => ok(undefined),
) =>
  createSplitWithPerson<string, string>({
    access: createSpaceAccess(repo),
    spaces: repo,
    direct,
    onCreated: async (space, { locale }) => {
      const seeded = await seedDefaultCategories({ spaceId: space.id, locale });
      return seeded.ok ? afterSeeding(space.id) : seeded;
    },
    recordExpense,
    ids,
    clock,
    tm,
  });
const recordsInTheSpace: Recorder = async ({ spaceId }) => ok(spaceId);
const splitBy = (user: Registered, counterpart: DirectSplitCounterpart) => ({
  userId: user.id,
  userName: user.name,
  locale: "es",
  counterpart,
  expense: "Dinner",
});

/** "Household" with Ana as OWNER and Juan as MEMBER: each is a member the other can split with. */
const householdOf = async (ana: Registered, juan: Registered) => {
  const household = await sharedSpaceFixture(db, ana.id);
  const juanMember: SpaceMember = {
    id: randomUUID() as SpaceMemberId,
    kind: "USER",
    userId: juan.id,
    displayName: juan.name,
    role: "MEMBER",
    contactEmail: null,
    joinedAt: new Date(),
  };
  expect(await repo.addMember(household.id, juanMember)).toBe("added");
  return { anaMemberId: household.members[0]!.id, juanMemberId: juanMember.id };
};

interface Footprint {
  readonly members: number;
  readonly groups: number;
  readonly categories: number;
}
/** What the open transaction holds of a space, read through the transaction like the use case does. */
const footprintIn = async (spaceId: string): Promise<Footprint> => ({
  members: (await repo.listCurrent(spaceId as Id<"Space">)).length,
  groups: (await categoryRepo.listGroups(spaceId)).length,
  categories: (await categoryRepo.listCategories(spaceId)).length,
});
/** What is committed in PostgreSQL of a space. */
const committedOf = async (spaceId: string) => ({
  spaces: await count("SELECT count(*)::int AS n FROM spaces WHERE id = $1", [spaceId]),
  members: await count("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [spaceId]),
  groups: await count("SELECT count(*)::int AS n FROM category_groups WHERE space_id = $1", [spaceId]),
  categories: await count("SELECT count(*)::int AS n FROM categories WHERE space_id = $1", [spaceId]),
});
const directSpacesOf = (userId: string) =>
  count(
    `SELECT count(*)::int AS n FROM spaces s JOIN space_members m ON m.space_id = s.id
     WHERE s.kind = 'DIRECT' AND m.user_id = $1`,
    [userId],
  );

/** Looks at what the open transaction holds of the new space when a step runs, then lets `fail` fail it. */
const lookingThen = (fail: () => Result<never>) => {
  const seen: { spaceId: string; inside: Footprint }[] = [];
  const look = async (spaceId: string) => {
    seen.push({ spaceId, inside: await footprintIn(spaceId) });
  };
  return {
    seen,
    afterSeeding: async (spaceId: string): Promise<Result<void>> => {
      await look(spaceId);
      return fail();
    },
    recordExpense: (async ({ spaceId }) => {
      await look(spaceId);
      return fail();
    }) satisfies Recorder,
  };
};
const expectRolledBack = async (seen: { spaceId: string; inside: Footprint }[]) => {
  expect(seen).toHaveLength(1);
  const { spaceId, inside } = seen[0]!;
  // The failing step ran while the space, both members and the seeded categories existed in the transaction...
  expect(inside.members).toBe(2);
  expect(inside.groups).toBeGreaterThan(0);
  expect(inside.categories).toBeGreaterThan(0);
  // ...and none of them is in PostgreSQL afterwards.
  expect(await committedOf(spaceId)).toEqual({ spaces: 0, members: 0, groups: 0, categories: 0 });
};

describe("SplitWithPerson over PostgreSQL (Review Focus 3, 5 and rollback)", () => {
  it("commits the direct space, both members and the seeded categories together", async () => {
    const { ana, juan } = await pair();
    const { juanMemberId } = await householdOf(ana, juan);
    const split = unwrap(await splitWith(recordsInTheSpace)(splitBy(ana, { memberId: juanMemberId })));
    expect(split).toMatchObject({ created: true, recorded: split.spaceId });
    expect(await direct.findByPairKey(pairKeyOf(ana.id, juan.id))).toBe(split.spaceId);
    const committed = await committedOf(split.spaceId);
    expect(committed).toMatchObject({ spaces: 1, members: 2 });
    expect(committed.groups).toBeGreaterThan(0);
    expect(committed.categories).toBeGreaterThan(0);
  });

  it("leaves no direct space, member or seeded category when the expense is refused", async () => {
    const { ana, juan } = await pair();
    const { juanMemberId } = await householdOf(ana, juan);
    const refusing = lookingThen(() => err(domainError("InvalidAmount")));
    const result = await splitWith(refusing.recordExpense)(splitBy(ana, { memberId: juanMemberId }));
    expect(codeOf(result)).toBe("InvalidAmount");
    await expectRolledBack(refusing.seen);
    expect(await direct.findByPairKey(pairKeyOf(ana.id, juan.id))).toBeNull();
    // The pair is free: a later split between them creates its space.
    expect(unwrap(await splitWith(recordsInTheSpace)(splitBy(ana, { memberId: juanMemberId }))).created).toBe(
      true,
    );
  });

  it("leaves no direct space, member or seeded category when seeding fails after storing categories", async () => {
    const { ana } = await pair();
    const failing = lookingThen(() => err(domainError("SeedingFailed")));
    const result = await splitWith(
      recordsInTheSpace,
      failing.afterSeeding,
    )(splitBy(ana, { guest: { displayName: "Pedro" } }));
    expect(codeOf(result)).toBe("SeedingFailed");
    await expectRolledBack(failing.seen);
    expect(await directSpacesOf(ana.id)).toBe(0);
  });

  it("leaves no direct space, member or seeded category when a step throws", async () => {
    const { ana, juan } = await pair();
    const { juanMemberId } = await householdOf(ana, juan);
    const crashing = lookingThen(() => {
      throw new Error("recorder crashed");
    });
    await expect(splitWith(crashing.recordExpense)(splitBy(ana, { memberId: juanMemberId }))).rejects.toThrow(
      "recorder crashed",
    );
    await expectRolledBack(crashing.seen);
    expect(await direct.findByPairKey(pairKeyOf(ana.id, juan.id))).toBeNull();
  });

  it("records two simultaneous first splits of a pair in one direct space that is seeded once", async () => {
    const { ana, juan } = await pair();
    const { anaMemberId, juanMemberId } = await householdOf(ana, juan);
    const split = splitWith(recordsInTheSpace);
    const [first, second] = (
      await Promise.all([
        split(splitBy(ana, { memberId: juanMemberId })),
        split(splitBy(juan, { memberId: anaMemberId })),
      ])
    ).map(unwrap);
    expect(first?.spaceId).toBe(second?.spaceId);
    expect([first?.created, second?.created].sort()).toEqual([false, true]);
    expect([first?.recorded, second?.recorded]).toEqual([first?.spaceId, first?.spaceId]);
    const spaceId = first!.spaceId;
    expect(await direct.findByPairKey(pairKeyOf(ana.id, juan.id))).toBe(spaceId);
    expect(await directSpacesOf(ana.id)).toBe(1);
    const duplicateGroups = `SELECT count(*)::int AS n FROM (
      SELECT name FROM category_groups WHERE space_id = $1 GROUP BY name HAVING count(*) > 1) d`;
    expect(await count(duplicateGroups, [spaceId])).toBe(0);
    expect((await committedOf(spaceId)).members).toBe(2);
  });

  it("answers MemberNotFound, creating nothing, for a malformed, unknown or foreign counterpart id (Review Focus 3)", async () => {
    const { ana, juan } = await pair();
    const trip = await sharedSpaceFixture(db, juan.id);
    const foreignMemberId = trip.members[0]!.id;
    const split = splitWith(recordsInTheSpace);
    for (const memberId of ["not-a-uuid", "", randomUUID(), foreignMemberId]) {
      expect(codeOf(await split(splitBy(ana, { memberId })))).toBe("MemberNotFound");
    }
    expect(await directSpacesOf(ana.id)).toBe(0);
    expect(await directSpacesOf(juan.id)).toBe(0);
  });
});
