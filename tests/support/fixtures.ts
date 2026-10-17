import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { NO_ATTRIBUTES } from "@/modules/accounts/domain/account";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { CUSTOM_GROUP_STYLE } from "@/modules/categories/domain/category-style";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import { createPersonalSpace, createSharedSpace, type Space } from "@/modules/spaces/domain/space";
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
    ...NO_ATTRIBUTES,
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
      key: null,
      style: CUSTOM_GROUP_STYLE,
      archivedAt: null,
      createdAt: new Date(),
    },
  ]);
  await repo.addCategories([
    {
      id: id as Id<"Category">,
      spaceId: space.spaceId,
      groupId,
      parentCategoryId: null,
      name,
      style: CUSTOM_GROUP_STYLE,
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

/** A registered user row (no personal space); `<name>-<id>@example.com` as email. */
export const userFixture = async (
  pool: Pool,
  name = "Ana",
): Promise<{ id: string; name: string; email: string }> => {
  const id = randomUUID();
  const email = `${name.toLowerCase()}-${id}@example.com`;
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [id, name, email]);
  return { id, name, email };
};

/** The shared space "Household" (COP) with `ownerId` as its only OWNER "Ana", written through the real spaces repository. */
export const sharedSpaceFixture = async (db: Database, ownerId: string, now = new Date()): Promise<Space> => {
  const space = createSharedSpace({
    id: randomUUID() as Id<"Space">,
    memberId: randomUUID() as Id<"SpaceMember">,
    ownerUserId: ownerId,
    ownerName: "Ana",
    name: "Household",
    currency: "COP",
    now,
  });
  if (!space.ok) throw new Error(space.error.code);
  await new DrizzleSpaceRepository(new DrizzleTransactionManager(db)).add(space.value);
  return space.value;
};

/** A SHARED_FUND account (no owner) in the shared space `spaceId`. */
export const fundAccountFixture = async (
  db: Database,
  spaceId: string,
  name = "Household Fund",
  openingBalance = 0n,
): Promise<string> => {
  const id = randomUUID();
  await new DrizzleAccountRepository(new DrizzleTransactionManager(db)).add({
    id: id as Id<"Account">,
    spaceId,
    name,
    type: "SHARED_FUND",
    ownerUserId: null,
    openingBalance,
    archivedAt: null,
    createdAt: new Date(),
    ...NO_ATTRIBUTES,
  });
  return id;
};

export interface SharedLedgerFixture {
  /** Ana's personal space, where her account lives. */
  readonly personal: SpaceFixture;
  /** "Household", with Ana as its OWNER (`household.memberId`). */
  readonly household: SpaceFixture;
  /** Ana's BANK account "Bancolombia" in her personal space. */
  readonly bank: string;
  /** Household's SHARED_FUND account. */
  readonly fund: string;
  /** The guest "Pedro" of Household. */
  readonly pedro: string;
  /** A category of Household. */
  readonly groceries: string;
}

/** Ana with Bancolombia in her personal space, and "Household" with the guest Pedro, its fund and a category. */
export const sharedLedgerFixture = async (db: Database, pool: Pool): Promise<SharedLedgerFixture> => {
  const personal = await personalSpaceFixture(db, pool, "Ana");
  const space = await sharedSpaceFixture(db, personal.userId);
  const household: SpaceFixture = {
    userId: personal.userId,
    spaceId: space.id,
    memberId: space.members[0]!.id,
  };
  return {
    personal,
    household,
    bank: await accountFixture(db, personal, "Bancolombia"),
    fund: await fundAccountFixture(db, household.spaceId),
    pedro: await guestMemberFixture(pool, household, "Pedro"),
    groceries: await categoryFixture(db, household),
  };
};
