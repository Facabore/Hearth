import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture } from "../../../../tests/support/fixtures";
import { seedTree } from "../domain/default-catalog";
import { DrizzleCategoryRepository } from "./drizzle-category-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleCategoryRepository(new DrizzleTransactionManager(db));
const ids = new UuidV7IdGenerator();

const seeded = async () => {
  const space = await personalSpaceFixture(db, pool);
  const tree = seedTree({ spaceId: space.spaceId, locale: "es", now: new Date("2026-10-12T12:00:00Z"), ids });
  await repo.addGroups(tree.groups);
  await repo.addCategories(tree.categories);
  return { space, tree };
};

afterAll(() => pool.end());

describe("DrizzleCategoryRepository", () => {
  it("stores and lists the seeded tree with catalog keys", async () => {
    const { space, tree } = await seeded();
    expect(await repo.hasAny(space.spaceId)).toBe(true);
    expect(await repo.listGroups(space.spaceId)).toEqual(expect.arrayContaining(tree.groups));
    const categories = await repo.listCategories(space.spaceId);
    expect(categories).toHaveLength(13);
    expect(categories).toContainEqual(
      expect.objectContaining({ name: "Mercado", key: "groceries", archivedAt: null }),
    );
  });

  it("reports a space without categories", async () => {
    const space = await personalSpaceFixture(db, pool);
    expect(await repo.hasAny(space.spaceId)).toBe(false);
    expect(await repo.listCategories(space.spaceId)).toEqual([]);
  });

  it("saves renames, moves and archive state, and deletes", async () => {
    const { space, tree } = await seeded();
    const housing = tree.groups[0]!;
    const food = tree.groups[1]!;
    const rent = tree.categories[0]!;
    const archivedAt = new Date("2026-10-13T00:00:00Z");
    await repo.saveCategories([{ ...rent, name: "Alquiler", groupId: food.id, archivedAt }]);
    await repo.saveGroup({ ...housing, name: "Hogar", archivedAt });
    expect((await repo.listCategories(space.spaceId)).find((c) => c.id === rent.id)).toEqual({
      ...rent,
      name: "Alquiler",
      groupId: food.id,
      archivedAt,
    });
    expect((await repo.listGroups(space.spaceId)).find((g) => g.id === housing.id)).toEqual({
      ...housing,
      name: "Hogar",
      archivedAt,
    });
    await repo.deleteCategory(space.spaceId, rent.id);
    expect((await repo.listCategories(space.spaceId)).map((c) => c.id)).not.toContain(rent.id);
  });

  it("enforces unique names per group ignoring case", async () => {
    const { tree } = await seeded();
    const mercado = tree.categories.find((c) => c.key === "groceries")!;
    await expect(
      repo.addCategories([{ ...mercado, id: ids.next<"Category">(), name: "MERCADO", key: null }]),
    ).rejects.toThrow();
  });

  it("enforces one category per catalog key and space", async () => {
    const { tree } = await seeded();
    const mercado = tree.categories.find((c) => c.key === "groceries")!;
    await expect(
      repo.addCategories([{ ...mercado, id: ids.next<"Category">(), name: "Otro mercado" }]),
    ).rejects.toThrow();
  });
});
