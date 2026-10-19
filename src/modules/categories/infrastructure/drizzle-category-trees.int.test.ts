import { afterAll, describe, expect, it, vi } from "vitest";
import type { CategoryTrees } from "@/modules/reporting/application";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture } from "../../../../tests/support/fixtures";
import type { Category, CategoryGroup } from "../domain/category";
import { seedTree } from "../domain/default-catalog";
import { DrizzleCategoryRepository } from "./drizzle-category-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleCategoryRepository(new DrizzleTransactionManager(db));
// Reporting's port, implemented by the repository with its own types (ruling P32): this line is the type check.
const trees: CategoryTrees = repo;
const ids = new UuidV7IdGenerator();

afterAll(() => pool.end());

/** A fresh space with the seeded tree in `locale` (HU-E3-01), its groups keyed by the catalog (HU-E3-05). */
const seeded = async (locale: string) => {
  const { spaceId } = await personalSpaceFixture(db, pool);
  const tree = seedTree({ spaceId, locale, now: new Date("2026-10-16T12:00:00Z"), ids });
  await repo.addGroups(tree.groups);
  await repo.addCategories(tree.categories);
  return {
    spaceId,
    group: (key: string): CategoryGroup => tree.groups.find((g) => g.key === key)!,
    category: (key: string): Category => tree.categories.find((c) => c.key === key)!,
  };
};

describe("the category trees a report reads (HU-E7-06)", () => {
  it("lists every category and subcategory where it sits now, with both catalog keys, archived ones too", async () => {
    const s = await seeded("en");
    const groceries = s.category("groceries");
    const restaurants = s.category("restaurants");
    const leisure = s.group("leisure");
    const pets: CategoryGroup = {
      ...s.group("food"),
      id: ids.next<"CategoryGroup">(),
      name: "Pets",
      key: null,
    };
    await repo.addGroups([pets]);
    // Copies of a stored row, so each has every column its level needs (HU-E3-05: a subcategory has no style).
    const vet: Category = {
      ...groceries,
      id: ids.next<"Category">(),
      groupId: pets.id,
      name: "Vet",
      key: null,
    };
    const vegetables: Category = {
      ...groceries,
      id: ids.next<"Category">(),
      parentCategoryId: groceries.id,
      name: "Vegetables",
      key: null,
      style: null,
    };
    const gone: Category = { ...groceries, id: ids.next<"Category">(), name: "Gone", key: null };
    await repo.addCategories([vet, vegetables, gone]);
    await repo.deleteCategory(s.spaceId, gone.id, new Date());
    // HU-E3-02: a moved category sits in its new group; HU-E3-03: an archived one is still listed.
    await repo.saveCategories([{ ...restaurants, groupId: leisure.id, archivedAt: new Date() }]);
    const rows = await trees.treesOf([s.spaceId]);
    // The 13 seeded categories, Vet and Vegetables; the deleted one is left out (D8).
    expect(rows).toHaveLength(15);
    expect(rows.find((r) => r.categoryId === restaurants.id)).toEqual({
      spaceId: s.spaceId,
      groupId: leisure.id,
      groupKey: "leisure",
      groupName: "Leisure",
      groupArchived: false,
      categoryId: restaurants.id,
      categoryKey: "restaurants",
      categoryName: "Restaurants",
      categoryArchived: true,
      parentCategoryId: null,
    });
    expect(rows.find((r) => r.categoryId === vegetables.id)).toMatchObject({
      groupKey: "food",
      categoryKey: null,
      parentCategoryId: groceries.id,
    });
    expect(rows.find((r) => r.categoryId === vet.id)).toMatchObject({
      groupId: pets.id,
      groupKey: null,
      groupName: "Pets",
    });
    expect(rows.some((r) => r.categoryId === gone.id)).toBe(false);
    expect([...new Set(rows.flatMap((r) => (r.groupKey === null ? [] : [r.groupKey])))].sort()).toEqual([
      "food",
      "health",
      "housing",
      "income",
      "leisure",
      "transport",
    ]);
  });

  it("answers only the spaces asked for, several in one statement, by space and then category", async () => {
    const en = await seeded("en");
    const es = await seeded("es");
    const other = await seeded("en");
    const query = vi.spyOn(pool, "query");
    const rows = await trees.treesOf([es.spaceId, en.spaceId, "not-a-uuid"]);
    // One round trip for the two spaces (and the malformed id never reaches the database).
    expect(query).toHaveBeenCalledTimes(1);
    query.mockRestore();
    expect(rows).toHaveLength(26);
    expect(rows.some((r) => r.spaceId === other.spaceId)).toBe(false);
    expect(rows.find((r) => r.categoryId === es.category("groceries").id)).toMatchObject({
      groupKey: "food",
      groupName: "Alimentación",
      categoryKey: "groceries",
      categoryName: "Mercado",
    });
    const order = rows.map((r) => `${r.spaceId}/${r.categoryId}`);
    expect(order).toEqual([...order].sort());
    expect(await trees.treesOf(["not-a-uuid"])).toEqual([]);
    expect(await trees.treesOf([])).toEqual([]);
  });

  it("flags an archived group on each of its categories and on no other", async () => {
    const s = await seeded("en");
    const leisure = s.group("leisure");
    await repo.saveGroup({ ...leisure, archivedAt: new Date() });
    const rows = await trees.treesOf([s.spaceId]);
    const inLeisure = rows.filter((r) => r.groupId === leisure.id);
    expect(inLeisure.length).toBeGreaterThan(0);
    expect(inLeisure.every((r) => r.groupArchived && !r.categoryArchived)).toBe(true);
    expect(rows.filter((r) => r.groupId !== leisure.id).some((r) => r.groupArchived)).toBe(false);
  });

  it("sorts by space first, whatever the category ids are", async () => {
    const [first, second] = [await seeded("en"), await seeded("en")].sort((a, b) =>
      a.spaceId < b.spaceId ? -1 : 1,
    );
    const lateId = "ffffffff-ffff-7fff-bfff-ffffffffffff" as Category["id"];
    const earlyId = "00000000-0000-7000-8000-000000000000" as Category["id"];
    // The earlier space holds the category with the later id, and the later space the one with the earlier id.
    await repo.addCategories([
      { ...first!.category("groceries"), id: lateId, name: "Late", key: null },
      { ...second!.category("groceries"), id: earlyId, name: "Early", key: null },
    ]);
    const rows = await trees.treesOf([second!.spaceId, first!.spaceId]);
    const order = rows.map((r) => r.categoryId);
    expect(order.indexOf(lateId)).toBeGreaterThan(-1);
    expect(order.indexOf(lateId)).toBeLessThan(order.indexOf(earlyId));
    expect(rows.slice(0, 13 + 1).every((r) => r.spaceId === first!.spaceId)).toBe(true);
  });
});
