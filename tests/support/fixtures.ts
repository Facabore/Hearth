import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { createPersonalSpace } from "@/modules/spaces/domain/space";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import type { Database } from "@/shared/infrastructure/db/client";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { Id } from "@/shared/kernel";

export interface SpaceFixture {
  readonly userId: string;
  readonly spaceId: string;
  readonly memberId: string;
}

/** A registered user with their personal space, written through the real spaces repository. */
export const personalSpaceFixture = async (db: Database, pool: Pool, name = "Ana"): Promise<SpaceFixture> => {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
    userId,
    name,
    `${userId}@example.com`,
  ]);
  const space = createPersonalSpace({
    id: randomUUID() as Id<"Space">,
    memberId: randomUUID() as Id<"SpaceMember">,
    ownerUserId: userId,
    ownerName: name,
    now: new Date(),
  });
  await new DrizzleSpaceRepository(new DrizzleTransactionManager(db)).add(space);
  return { userId, spaceId: space.id, memberId: space.members[0]!.id };
};

/** A BANK account owned by the space owner. */
export const accountFixture = async (
  db: Database,
  space: SpaceFixture,
  name: string,
  openingBalance = 0n,
): Promise<string> => {
  const id = randomUUID();
  await new DrizzleAccountRepository(new DrizzleTransactionManager(db)).add({
    id: id as Id<"Account">,
    spaceId: space.spaceId,
    name,
    type: "BANK",
    ownerUserId: space.userId,
    openingBalance,
    archivedAt: null,
    createdAt: new Date(),
  });
  return id;
};

/** A category in a fresh group of the space; returns the category id. */
export const categoryFixture = async (
  db: Database,
  space: SpaceFixture,
  name = "Groceries",
): Promise<string> => {
  const repo = new DrizzleCategoryRepository(new DrizzleTransactionManager(db));
  const groupId = randomUUID() as Id<"CategoryGroup">;
  const id = randomUUID();
  await repo.addGroups([
    {
      id: groupId,
      spaceId: space.spaceId,
      name: `Group ${groupId}`,
      archivedAt: null,
      createdAt: new Date(),
    },
  ]);
  await repo.addCategories([
    {
      id: id as Id<"Category">,
      spaceId: space.spaceId,
      groupId,
      name,
      key: null,
      archivedAt: null,
      createdAt: new Date(),
    },
  ]);
  return id;
};

/** A second (guest) member row, only to exercise member filters before M2 brings real shared spaces. */
export const guestMemberFixture = async (pool: Pool, space: SpaceFixture, name = "Juan"): Promise<string> => {
  const id = randomUUID();
  await pool.query(
    "INSERT INTO space_members (id, space_id, kind, display_name, joined_at) VALUES ($1, $2, 'GUEST', $3, now())",
    [id, space.spaceId, name],
  );
  return id;
};
