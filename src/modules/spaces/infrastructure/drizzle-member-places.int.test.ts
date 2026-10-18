import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { testDatabase } from "../../../../tests/support/database";
import {
  guestMemberFixture,
  personalSpaceFixture,
  sharedSpaceFixture,
  userFixture,
} from "../../../../tests/support/fixtures";
import type { SpaceMember, SpaceMemberId } from "../domain/space";
import { DrizzleSpaceRepository } from "./drizzle-space-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleSpaceRepository(new DrizzleTransactionManager(db));

afterAll(() => pool.end());

const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const place = (spaceId: string, memberId: string, spaceName: string, spaceKind: string) => ({
  memberId,
  spaceId,
  spaceName,
  spaceKind,
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
});

describe("a user's places (HU-E7-04, D15)", () => {
  it("lists every member row of the user, left and claimed ones included, oldest space first, and no one else's", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const juan = await userFixture(pool, "Juan");
    const household = await sharedSpaceFixture(db, ana.userId, later(1));
    const trip = await sharedSpaceFixture(db, juan.id, later(2));
    const left: SpaceMember = {
      id: randomUUID() as SpaceMemberId,
      kind: "USER",
      userId: ana.userId,
      displayName: "Ana B",
      role: "MEMBER",
      contactEmail: null,
      joinedAt: later(3),
    };
    expect(await repo.addMember(trip.id, left)).toBe("added");
    expect(await repo.markLeft(trip.id, left.id, "USER", later(4))).toBe(true);
    // HU-E1-09: an archived space keeps its rows in the user's view.
    await pool.query("UPDATE spaces SET archived_at = now() WHERE id = $1", [household.id]);
    const camping = await sharedSpaceFixture(db, juan.id, later(5));
    const guest = await guestMemberFixture(
      pool,
      { userId: juan.id, spaceId: camping.id, memberId: camping.members[0]!.id },
      "Pedro",
    );
    const claimed: SpaceMember = {
      ...left,
      id: guest as SpaceMemberId,
      displayName: "Pedro",
      joinedAt: later(6),
    };
    expect(await repo.claimGuest(camping.id, claimed, later(7))).toBe("claimed");
    expect(await repo.placesOf(ana.userId)).toEqual([
      place(ana.spaceId, ana.memberId, "Personal", "PERSONAL"),
      place(household.id, household.members[0]!.id, "Household", "SHARED"),
      place(trip.id, left.id, "Household", "SHARED"),
      place(camping.id, guest, "Household", "SHARED"),
    ]);
    expect(await repo.placesOf(randomUUID())).toEqual([]);
  });
});
