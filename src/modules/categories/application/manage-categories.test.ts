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
import { createCreateCategory } from "./create-category";
import { createCreateCategoryGroup } from "./create-category-group";
import type { CategoriesDeps } from "./deps";
import { createRenameCategoryGroup } from "./rename-category-group";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const household = membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const asAna = { spaceId: "space-household", userId: "u-ana" };

const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(household, sofi, membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  const seed = createSeedDefaultCategories(deps);
  unwrap(await seed({ spaceId: "space-household", locale: "en" }));
  unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
  return {
    categories,
    group: (spaceId: string, name: string) =>
      categories.groups.find((g) => g.spaceId === spaceId && g.name === name)!,
    category: (spaceId: string, name: string) =>
      categories.categories.find((c) => c.spaceId === spaceId && c.name === name)!,
    createGroup: createCreateCategoryGroup(deps),
    renameGroup: createRenameCategoryGroup(deps),
    create: createCreateCategory(deps),
    update: createUpdateCategory(deps),
  };
};

describe("category tree management (HU-E3-02)", () => {
  it("creates a category in an existing group", async () => {
    const { categories, group, create } = await setup();
    const food = group("space-household", "Food");
    expect(unwrap(await create({ ...asAna, groupId: food.id, name: "Bakery" }))).toMatchObject({
      groupId: food.id,
      name: "Bakery",
      key: null,
    });
    expect(categories.categories.filter((c) => c.groupId === food.id).map((c) => c.name)).toContain("Bakery");
  });

  it("renames a group and keeps its categories", async () => {
    const { categories, group, renameGroup } = await setup();
    const leisure = group("space-household", "Leisure");
    expect(unwrap(await renameGroup({ ...asAna, groupId: leisure.id, name: "Fun" })).name).toBe("Fun");
    expect(categories.categories.filter((c) => c.groupId === leisure.id).map((c) => c.name)).toEqual([
      "Entertainment",
      "Travel",
    ]);
  });

  it("moves a category to another group and keeps its id, so transactions keep their category", async () => {
    const { group, category, update } = await setup();
    const pharmacy = category("space-household", "Pharmacy");
    const food = group("space-household", "Food");
    expect(unwrap(await update({ ...asAna, categoryId: pharmacy.id, groupId: food.id }))).toMatchObject({
      id: pharmacy.id,
      groupId: food.id,
      key: "pharmacy",
    });
  });

  it("rejects a third level", async () => {
    const { category, create } = await setup();
    const groceries = category("space-household", "Groceries");
    expect(codeOf(await create({ ...asAna, groupId: groceries.id, name: "Organic" }))).toBe(
      "CategoryDepthExceeded",
    );
  });

  it("rejects a duplicate name in the same group ignoring case", async () => {
    const { group, create } = await setup();
    const food = group("space-household", "Food");
    expect(codeOf(await create({ ...asAna, groupId: food.id, name: "groceries" }))).toBe("CategoryNameTaken");
  });

  it("forbids viewers", async () => {
    const { group, create } = await setup();
    const leisure = group("space-household", "Leisure");
    const result = await create({
      spaceId: "space-household",
      userId: "u-sofi",
      groupId: leisure.id,
      name: "Pets",
    });
    expect(codeOf(result)).toBe("InsufficientRole");
  });

  it("keeps each space's seeded categories independent (HU-E3-01)", async () => {
    const { categories, category, update } = await setup();
    const before = categories.categories.filter((c) => c.spaceId === "space-household");
    const arriendo = category("space-ana", "Arriendo");
    unwrap(
      await update({ spaceId: "space-ana", userId: "u-ana", categoryId: arriendo.id, name: "Alquiler" }),
    );
    expect(categories.categories.filter((c) => c.spaceId === "space-household")).toEqual(before);
  });

  it("keeps the catalog key on rename; categories users create have none (HU-E3-01)", async () => {
    const { group, category, create, update } = await setup();
    const asAnaPersonal = { spaceId: "space-ana", userId: "u-ana" };
    const mercado = category("space-ana", "Mercado");
    expect(unwrap(await update({ ...asAnaPersonal, categoryId: mercado.id, name: "Supermercado" })).key).toBe(
      "groceries",
    );
    const food = group("space-ana", "Alimentación");
    expect(unwrap(await create({ ...asAnaPersonal, groupId: food.id, name: "Panadería" })).key).toBeNull();
  });

  it("reports unknown groups and categories, and duplicate group names", async () => {
    const { createGroup, create, update } = await setup();
    expect(codeOf(await create({ ...asAna, groupId: "nope", name: "Pets" }))).toBe("CategoryGroupNotFound");
    expect(codeOf(await update({ ...asAna, categoryId: "nope", name: "Pets" }))).toBe("CategoryNotFound");
    expect(codeOf(await createGroup({ ...asAna, name: "food" }))).toBe("CategoryGroupNameTaken");
    expect(unwrap(await createGroup({ ...asAna, name: "Pets" })).name).toBe("Pets");
  });

  it("never uses a group of another space", async () => {
    const { group, create } = await setup();
    const householdFood = group("space-household", "Food");
    const result = await create({
      spaceId: "space-ana",
      userId: "u-ana",
      groupId: householdFood.id,
      name: "Pan",
    });
    expect(codeOf(result)).toBe("CategoryGroupNotFound");
  });
});
