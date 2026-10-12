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

const setup = () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  return { categories, seed: createSeedDefaultCategories(deps), list: createListCategories(deps) };
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
  it("returns the active tree sorted by name, with catalog keys", async () => {
    const { seed, list } = setup();
    unwrap(await seed({ spaceId: "space-ana", locale: "es" }));
    const tree = unwrap(await list({ ...asAna, includeArchived: false }));
    expect(tree.map((g) => g.name)).toEqual([
      "Alimentación",
      "Ingresos",
      "Ocio",
      "Salud",
      "Transporte",
      "Vivienda",
    ]);
    expect(tree[0]?.categories.map((c) => [c.name, c.key])).toEqual([
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
