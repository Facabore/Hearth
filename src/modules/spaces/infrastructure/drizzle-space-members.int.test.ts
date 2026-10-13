import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { ok } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { sharedSpaceFixture, userFixture } from "../../../../tests/support/fixtures";
import { createChangeMemberRole } from "../application/change-member-role";
import { createSpaceAccess } from "../application/space-access";
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
    const owners = "SELECT count(*)::int AS n FROM space_members WHERE space_id = $1 AND role = 'OWNER'";
    expect(await count(owners, [space.id])).toBe(1);
  });
});
