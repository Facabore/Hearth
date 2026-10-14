import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
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
import { createDeleteCategory } from "./delete-category";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createRestoreCategory } from "./restore-category";
import { createSeedDefaultCategories } from "./seed-default-categories";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const asAna = { spaceId: "space-household", userId: "u-ana" };

const setup = async () => {
  const categories = new InMemoryCategories();
  const referenced = new Set<string>();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(household, sofi),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  unwrap(await createSeedDefaultCategories(deps)({ spaceId: "space-household", locale: "en" }));
  const named = (name: string) => categories.categories.find((c) => c.name === name)!;
  const activeNames = async () =>
    unwrap(await createListCategories(deps)({ ...asAna, includeArchived: false }))
      .flatMap((g) => g.categories)
      .map((c) => c.name);
  return {
    categories,
    referenced,
    named,
    activeNames,
    create: createCreateCategory(deps),
    remove: createDeleteCategory({
      ...deps,
      usage: { isCategoryReferenced: async (id) => referenced.has(id) },
    }),
    archive: createArchiveCategory(deps),
    restore: createRestoreCategory(deps),
    archiveGroup: createArchiveCategoryGroup(deps),
    list: createListCategories(deps),
  };
};

describe("retiring categories (HU-E3-03)", () => {
  it("deletes a category without transactions", async () => {
    const { categories, create, remove, activeNames } = await setup();
    const food = categories.groups.find((g) => g.name === "Food")!;
    const bakery = unwrap(await create({ ...asAna, groupId: food.id, name: "Bakery" }));
    unwrap(await remove({ ...asAna, categoryId: bakery.id }));
    // D8 (Task 0a): the row stays, marked deleted, and every list, lookup and name check skips it.
    expect(categories.categories.map((c) => c.id)).toContain(bakery.id);
    expect(categories.deleted.get(bakery.id)).toEqual(new Date("2026-10-12T12:00:00Z"));
    expect(await activeNames()).not.toContain("Bakery");
    expect(codeOf(await remove({ ...asAna, categoryId: bakery.id }))).toBe("CategoryNotFound");
    expect(unwrap(await create({ ...asAna, groupId: food.id, name: "Bakery" })).id).not.toBe(bakery.id);
  });

  it("refuses to delete a referenced category, which can still be archived", async () => {
    const { categories, referenced, named, remove, archive } = await setup();
    const groceries = named("Groceries");
    referenced.add(groceries.id);
    expect(codeOf(await remove({ ...asAna, categoryId: groceries.id }))).toBe("CategoryInUse");
    expect(categories.categories.map((c) => c.id)).toContain(groceries.id);
    expect(unwrap(await archive({ ...asAna, categoryId: groceries.id })).archivedAt).not.toBeNull();
  });

  it("keeps archived categories out of the active list but available on request", async () => {
    const { named, archive, activeNames, list } = await setup();
    unwrap(await archive({ ...asAna, categoryId: named("Groceries").id }));
    expect(await activeNames()).not.toContain("Groceries");
    const everything = unwrap(await list({ ...asAna, includeArchived: true }));
    expect(everything.flatMap((g) => g.categories).map((c) => c.name)).toContain("Groceries");
  });

  it("restores an archived category", async () => {
    const { named, archive, restore, activeNames } = await setup();
    const groceries = named("Groceries");
    unwrap(await archive({ ...asAna, categoryId: groceries.id }));
    expect(unwrap(await restore({ ...asAna, categoryId: groceries.id })).archivedAt).toBeNull();
    expect(await activeNames()).toContain("Groceries");
  });

  it("archives a group with all its categories", async () => {
    const { categories, named, archiveGroup, restore } = await setup();
    const leisure = categories.groups.find((g) => g.name === "Leisure")!;
    expect(unwrap(await archiveGroup({ ...asAna, groupId: leisure.id })).archivedAt).not.toBeNull();
    expect(
      categories.categories.filter((c) => c.groupId === leisure.id).every((c) => c.archivedAt !== null),
    ).toBe(true);
    expect(codeOf(await restore({ ...asAna, categoryId: named("Travel").id }))).toBe("CategoryGroupArchived");
  });

  it("forbids viewers and reports unknown ids", async () => {
    const { named, remove, archiveGroup } = await setup();
    const asSofi = { spaceId: "space-household", userId: "u-sofi" };
    expect(codeOf(await remove({ ...asSofi, categoryId: named("Groceries").id }))).toBe("InsufficientRole");
    expect(codeOf(await remove({ ...asAna, categoryId: "nope" }))).toBe("CategoryNotFound");
    expect(codeOf(await archiveGroup({ ...asAna, groupId: "nope" }))).toBe("CategoryGroupNotFound");
  });
});
