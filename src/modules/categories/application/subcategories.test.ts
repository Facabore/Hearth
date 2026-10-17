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
import { createCreateCategory } from "./create-category";
import { createDeleteCategory } from "./delete-category";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createRestoreCategory } from "./restore-category";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

/** Ana's personal space, seeded in Spanish: "Mercado" and "Restaurantes" in "Alimentación". */
const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-16T12:00:00Z")),
    tm: memoryTm,
  };
  unwrap(await createSeedDefaultCategories(deps)({ spaceId: "space-ana", locale: "es" }));
  const named = (name: string) => categories.categories.find((c) => c.name === name)!;
  const create = createCreateCategory(deps);
  const sub = async (parent: string, name: string) =>
    unwrap(await create({ ...asAna, parentCategoryId: named(parent).id, name }));
  return {
    named,
    sub,
    create,
    update: createUpdateCategory(deps),
    archive: createArchiveCategory(deps),
    restore: createRestoreCategory(deps),
    remove: createDeleteCategory({ ...deps, usage: { isCategoryReferenced: async () => false } }),
    list: createListCategories(deps),
  };
};

describe("subcategories (HU-E3-04)", () => {
  it("creates Verduras and Carnes under Mercado and lists them nested", async () => {
    const w = await setup();
    await w.sub("Mercado", "Verduras");
    await w.sub("Mercado", "Carnes");
    const groups = unwrap(await w.list({ ...asAna, includeArchived: false }));
    const mercado = groups.flatMap((g) => g.categories).find((c) => c.name === "Mercado")!;
    expect(mercado.subcategories.map((s) => [s.name, s.groupId, s.key])).toEqual([
      ["Carnes", mercado.groupId, null],
      ["Verduras", mercado.groupId, null],
    ]);
    expect(groups.flatMap((g) => g.categories).some((c) => c.name === "Verduras")).toBe(false);
  });

  it("hides archived subcategories like archived categories, unless asked for", async () => {
    const w = await setup();
    await w.sub("Mercado", "Carnes");
    const verduras = await w.sub("Mercado", "Verduras");
    unwrap(await w.archive({ ...asAna, categoryId: verduras.id }));
    const subcategoriesOfMercado = async (includeArchived: boolean) =>
      unwrap(await w.list({ ...asAna, includeArchived }))
        .flatMap((g) => g.categories)
        .find((c) => c.name === "Mercado")!
        .subcategories.map((s) => s.name);
    expect(await subcategoriesOfMercado(false)).toEqual(["Carnes"]);
    expect(await subcategoriesOfMercado(true)).toEqual(["Carnes", "Verduras"]);
  });

  it("gives a subcategory its parent's group, whatever group is named with it", async () => {
    const w = await setup();
    const mercado = w.named("Mercado");
    const farmacia = w.named("Farmacia");
    const health = farmacia.groupId;
    const created = await w.create({
      ...asAna,
      parentCategoryId: mercado.id,
      groupId: health,
      name: "Verduras",
    });
    expect(unwrap(created)).toMatchObject({ groupId: mercado.groupId, parentCategoryId: mercado.id });
    const demoted = await w.update({
      ...asAna,
      categoryId: farmacia.id,
      parentCategoryId: mercado.id,
      groupId: health,
    });
    expect(unwrap(demoted)).toMatchObject({ groupId: mercado.groupId, parentCategoryId: mercado.id });
    const promoted = await w.update({
      ...asAna,
      categoryId: farmacia.id,
      parentCategoryId: null,
      groupId: health,
    });
    expect(unwrap(promoted)).toMatchObject({ groupId: health, parentCategoryId: null });
  });

  it("refuses a fourth level, an unknown parent and moving a category with subcategories under another", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    expect(codeOf(await w.create({ ...asAna, parentCategoryId: verduras.id, name: "Orgánico" }))).toBe(
      "CategoryDepthExceeded",
    );
    expect(codeOf(await w.create({ ...asAna, parentCategoryId: "nope", name: "X" }))).toBe(
      "CategoryNotFound",
    );
    const moved = await w.update({
      ...asAna,
      categoryId: w.named("Mercado").id,
      parentCategoryId: w.named("Restaurantes").id,
    });
    expect(codeOf(moved)).toBe("CategoryDepthExceeded");
  });

  it("moves the subcategories with their category to another group", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    const otherGroup = w.named("Farmacia").groupId;
    unwrap(await w.update({ ...asAna, categoryId: w.named("Mercado").id, groupId: otherGroup }));
    expect(w.named("Verduras")).toMatchObject({
      id: verduras.id,
      groupId: otherGroup,
      parentCategoryId: w.named("Mercado").id,
    });
  });

  it("archives the subcategories with Mercado, and restores Verduras only once Mercado is back", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    unwrap(await w.archive({ ...asAna, categoryId: w.named("Mercado").id }));
    expect(w.named("Verduras").archivedAt).not.toBeNull();
    expect(codeOf(await w.restore({ ...asAna, categoryId: verduras.id }))).toBe("ParentCategoryArchived");
    unwrap(await w.restore({ ...asAna, categoryId: w.named("Mercado").id }));
    expect(w.named("Verduras").archivedAt).not.toBeNull(); // a category restores alone (P47)
    expect(unwrap(await w.restore({ ...asAna, categoryId: verduras.id })).archivedAt).toBeNull();
  });

  it("keeps a category with live subcategories, archived ones included, from being deleted", async () => {
    const w = await setup();
    const verduras = await w.sub("Mercado", "Verduras");
    unwrap(await w.archive({ ...asAna, categoryId: verduras.id }));
    expect(codeOf(await w.remove({ ...asAna, categoryId: w.named("Mercado").id }))).toBe("CategoryInUse");
    unwrap(await w.remove({ ...asAna, categoryId: verduras.id }));
    expect(codeOf(await w.remove({ ...asAna, categoryId: w.named("Mercado").id }))).toBe("ok");
  });
});
