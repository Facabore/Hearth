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
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createSeedDefaultCategories } from "./seed-default-categories";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

const setup = (counts: ReadonlyMap<string, number> = new Map()) => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  const asked: string[] = [];
  const usage = {
    usageCountsOf: async (spaceId: string) => {
      asked.push(spaceId);
      return counts;
    },
  };
  return {
    categories,
    asked,
    seed: createSeedDefaultCategories(deps),
    list: createListCategories({ ...deps, counts: usage }),
  };
};

describe("SeedDefaultCategories (HU-E3-01)", () => {
  it("seeds the default tree into a space", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    expect(categories.groups.map((g) => g.name)).toContain("Vivienda");
    expect(categories.categories).toHaveLength(13);
  });

  it("is idempotent", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    expect(categories.groups).toHaveLength(6);
    expect(categories.categories).toHaveLength(13);
  });

  it("seeds English names for an English locale", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-flat", locale: "en" }));
    expect(categories.groups.map((g) => g.name)).toContain("Housing");
  });

  it("gives each space its own rows", async () => {
    const { categories, seed } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    unwrap(await seed({ spaceId: "space-household", locale: "en" }));
    const idsOf = (spaceId: string) =>
      categories.categories.filter((c) => c.spaceId === spaceId).map((c) => c.id);
    expect(idsOf("space-ana")).toHaveLength(13);
    expect(idsOf("space-ana").filter((id) => idsOf("space-household").includes(id))).toEqual([]);
  });
});

describe("ListCategories", () => {
  it("returns the active tree, groups in their own order (P296) and categories by name, with catalog keys", async () => {
    const { seed, list } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    const tree = unwrap(await list({ ...asAna, includeArchived: false }));
    expect(tree.map((g) => g.name)).toEqual([
      "Vivienda",
      "Alimentación",
      "Transporte",
      "Salud",
      "Ocio",
      "Ingresos",
    ]);
    expect(tree[1]?.categories.map((c) => [c.name, c.key])).toEqual([
      ["Mercado", "groceries"],
      ["Restaurantes", "restaurants"],
    ]);
  });

  it("hides archived groups and categories unless asked", async () => {
    const { categories, seed, list } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    const mercado = categories.categories.find((c) => c.key === "groceries")!;
    const leisure = categories.groups.find((g) => g.name === "Ocio")!;
    await categories.saveCategories([{ ...mercado, archivedAt: new Date() }]);
    await categories.saveGroup({ ...leisure, archivedAt: new Date() });

    const active = unwrap(await list({ ...asAna, includeArchived: false }));
    expect(active.map((g) => g.name)).not.toContain("Ocio");
    expect(active.flatMap((g) => g.categories).map((c) => c.name)).not.toContain("Mercado");

    const everything = unwrap(await list({ ...asAna, includeArchived: true }));
    expect(everything.map((g) => g.name)).toContain("Ocio");
    expect(everything.flatMap((g) => g.categories).map((c) => c.name)).toContain("Mercado");
  });

  it("hides spaces the user does not belong to", async () => {
    const { list } = setup();
    expect(codeOf(await list({ spaceId: "space-ana", userId: "u-luis", includeArchived: false }))).toBe(
      "SpaceNotFound",
    );
  });
});

describe("usage count per category (#240, ruling P297)", () => {
  it("gives every category and subcategory its own count, 0 for one no movement names, from one read of the space", async () => {
    const counts = new Map<string, number>();
    const { categories, asked, seed, list } = setup(counts);
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    const groceries = categories.categories.find((c) => c.key === "groceries")!;
    const rent = categories.categories.find((c) => c.key === "rent")!;
    const vegetables = {
      ...groceries,
      id: "cat-veg" as typeof groceries.id,
      parentCategoryId: groceries.id,
      name: "Verduras",
      key: null,
      style: null,
    };
    categories.categories.push(vegetables);
    counts.set(groceries.id, 12).set(rent.id, 1).set(vegetables.id, 3);

    const tree = unwrap(await list({ ...asAna, includeArchived: false }));
    const food = tree.find((g) => g.key === "food")!;
    const node = food.categories.find((c) => c.id === groceries.id)!;
    // A subcategory's movements count toward the subcategory, never its parent.
    expect(node.usageCount).toBe(12);
    expect(node.subcategories.map((s) => [s.name, s.usageCount])).toEqual([["Verduras", 3]]);
    expect(food.categories.find((c) => c.key === "restaurants")!.usageCount).toBe(0);
    expect(tree.find((g) => g.key === "housing")!.categories.find((c) => c.id === rent.id)!.usageCount).toBe(
      1,
    );
    expect(asked).toEqual(["space-ana"]);
  });
});
