import { describe, expect, it } from "vitest";
import { FixedClock, type Result } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  memoryTm,
  membership,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { InMemoryCategories } from "../../../../tests/support/in-memory-categories";
import { createArchiveCategory } from "./archive-category";
import { createArchiveCategoryGroup } from "./archive-category-group";
import { createCreateCategory } from "./create-category";
import { createCreateCategoryGroup } from "./create-category-group";
import { createDeleteCategory } from "./delete-category";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createRenameCategoryGroup } from "./rename-category-group";
import { createRestoreCategory } from "./restore-category";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const asAna = { spaceId: "space-household", userId: "u-ana" };
const household = (archived: boolean) =>
  membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED", archived });

/**
 * Household seeded in English, with Restaurants archived while the space was active so that RestoreCategory
 * has something to restore; then archived or not, as Ana (OWNER) sees it.
 */
const world = async (archived: boolean) => {
  const categories = new InMemoryCategories();
  const shared = {
    categories,
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  const whileActive: CategoriesDeps = { ...shared, access: fakeSpaceAccess(household(false)) };
  unwrap(await createSeedDefaultCategories(whileActive)({ spaceId: "space-household", locale: "en" }));
  const named = (name: string) => categories.categories.find((c) => c.name === name)!;
  const food = categories.groups.find((g) => g.name === "Food")!;
  const leisure = categories.groups.find((g) => g.name === "Leisure")!;
  unwrap(await createArchiveCategory(whileActive)({ ...asAna, categoryId: named("Restaurants").id }));
  const deps: CategoriesDeps = { ...shared, access: fakeSpaceAccess(household(archived)) };
  return {
    categories,
    named,
    food,
    leisure,
    createGroup: createCreateCategoryGroup(deps),
    renameGroup: createRenameCategoryGroup(deps),
    create: createCreateCategory(deps),
    update: createUpdateCategory(deps),
    remove: createDeleteCategory({ ...deps, usage: { isCategoryReferenced: async () => false } }),
    archive: createArchiveCategory(deps),
    restore: createRestoreCategory(deps),
    archiveGroup: createArchiveCategoryGroup(deps),
    list: createListCategories(deps),
  };
};
type World = Awaited<ReturnType<typeof world>>;

const WRITES: readonly (readonly [string, (w: World) => Promise<Result<unknown>>])[] = [
  ["CreateCategoryGroup", (w) => w.createGroup({ ...asAna, name: "Pets" })],
  ["RenameCategoryGroup", (w) => w.renameGroup({ ...asAna, groupId: w.food.id, name: "Eating" })],
  ["CreateCategory", (w) => w.create({ ...asAna, groupId: w.food.id, name: "Bakery" })],
  ["UpdateCategory", (w) => w.update({ ...asAna, categoryId: w.named("Groceries").id, name: "Market" })],
  ["DeleteCategory", (w) => w.remove({ ...asAna, categoryId: w.named("Groceries").id })],
  ["ArchiveCategory", (w) => w.archive({ ...asAna, categoryId: w.named("Groceries").id })],
  ["RestoreCategory", (w) => w.restore({ ...asAna, categoryId: w.named("Restaurants").id })],
  ["ArchiveCategoryGroup", (w) => w.archiveGroup({ ...asAna, groupId: w.leisure.id })],
];

describe("archived spaces only read: categories (HU-E1-09, Review Focus 4)", () => {
  it.each(WRITES)("%s answers SpaceArchived, where an active space accepts it", async (_name, write) => {
    expect(codeOf(await write(await world(false)))).toBe("ok");
    const archived = await world(true);
    const before = {
      groups: [...archived.categories.groups],
      categories: [...archived.categories.categories],
    };
    expect(codeOf(await write(archived))).toBe("SpaceArchived");
    expect({ groups: archived.categories.groups, categories: archived.categories.categories }).toEqual(
      before,
    );
    expect(archived.categories.deleted.size).toBe(0);
  });

  it("still lists its categories, archived ones on request", async () => {
    const w = await world(true);
    const active = unwrap(await w.list({ ...asAna, includeArchived: false })).flatMap((g) => g.categories);
    expect(active.map((c) => c.name)).toContain("Groceries");
    expect(active.map((c) => c.name)).not.toContain("Restaurants");
    const everything = unwrap(await w.list({ ...asAna, includeArchived: true })).flatMap((g) => g.categories);
    expect(everything.map((c) => c.name)).toContain("Restaurants");
  });
});
