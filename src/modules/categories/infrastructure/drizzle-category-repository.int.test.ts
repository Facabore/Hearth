import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture } from "../../../../tests/support/fixtures";
import type { Category, CategoryGroupId, CategoryId } from "../domain/category";
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
    await repo.deleteCategory(space.spaceId, rent.id, archivedAt);
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

  it("keeps a deleted category stored and referenced, out of lists and name checks (D8, Task 0a)", async () => {
    const { space, tree } = await seeded();
    const mercado = tree.categories.find((c) => c.key === "groceries")!;
    const transactionId = randomUUID();
    await pool.query(
      `INSERT INTO transactions (id, space_id, type, description, date, category_id, amount, currency, created_by, created_at, updated_at)
       VALUES ($1, $2, 'EXPENSE', 'Market', '2026-10-05', $3, 100, 'COP', $4, now(), now())`,
      [transactionId, space.spaceId, mercado.id, space.userId],
    );
    const deletedAt = new Date("2026-10-14T12:00:00Z");
    await repo.deleteCategory(space.spaceId, mercado.id, deletedAt);
    const { rows } = await pool.query(
      `SELECT c.deleted_at, t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id WHERE t.id = $1`,
      [transactionId],
    );
    expect(rows).toEqual([{ deleted_at: deletedAt, category_id: mercado.id }]);
    expect((await repo.listCategories(space.spaceId)).map((c) => c.id)).not.toContain(mercado.id);
    // The name is free again among the categories that are not deleted (partial categories_parent_name_uq).
    await expect(
      repo.addCategories([{ ...mercado, id: ids.next<"Category">(), name: "MERCADO", key: null }]),
    ).resolves.toBeUndefined();
  });
});

/** A fresh space with the group "Food"; `category(name, parentId)` builds a live category of it. */
const subcategoryWorld = async () => {
  const space = (await personalSpaceFixture(db, pool)).spaceId;
  const food = randomUUID();
  await repo.addGroups([
    { id: food as CategoryGroupId, spaceId: space, name: "Food", archivedAt: null, createdAt: new Date() },
  ]);
  const category = (name: string, parentId: string | null): Category => ({
    id: randomUUID() as CategoryId,
    spaceId: space,
    groupId: food as CategoryGroupId,
    parentCategoryId: parentId as CategoryId | null,
    name,
    key: null,
    archivedAt: null,
    createdAt: new Date("2026-10-16T12:00:00.000Z"),
  });
  return { repo, space, food, category };
};

describe("subcategories (HU-E3-04)", () => {
  it("stores a subcategory under its parent and moves it with its siblings' names", async () => {
    const { repo, space, food, category } = await subcategoryWorld();
    const groceries = category("Groceries", null);
    const vegetables = category("Vegetables", groceries.id);
    await repo.addCategories([groceries, vegetables]);
    expect((await repo.listCategories(space)).find((c) => c.id === vegetables.id)).toEqual(vegetables);
    // A subcategory may share its name with a category elsewhere, never with a sibling.
    await repo.addCategories([category("Vegetables", null)]);
    await expect(repo.addCategories([category("vegetables", groceries.id)])).rejects.toMatchObject({
      cause: { constraint: "categories_parent_name_uq" },
    });
    await repo.saveCategories([{ ...vegetables, parentCategoryId: null, name: "Veggies" }]);
    expect((await repo.listCategories(space)).find((c) => c.id === vegetables.id)).toMatchObject({
      parentCategoryId: null,
      groupId: food,
    });
  });

  it("lets subcategories of different parents share a name", async () => {
    const { repo, space, category } = await subcategoryWorld();
    const groceries = category("Groceries", null);
    const dairy = category("Dairy", null);
    await repo.addCategories([
      groceries,
      dairy,
      category("Organic", groceries.id),
      category("Organic", dairy.id),
    ]);
    expect((await repo.listCategories(space)).filter((c) => c.name === "Organic")).toHaveLength(2);
  });

  it("refuses a category that is its own parent", async () => {
    const { repo, category } = await subcategoryWorld();
    const groceries = category("Groceries", null);
    await repo.addCategories([groceries]);
    await expect(
      repo.saveCategories([{ ...groceries, parentCategoryId: groceries.id }]),
    ).rejects.toMatchObject({ cause: { constraint: "categories_not_own_parent" } });
  });
});
