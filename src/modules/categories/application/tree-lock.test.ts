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
import type { CategoryRepository } from "./category-repository";
import { createCreateCategory } from "./create-category";
import { createCreateCategoryGroup } from "./create-category-group";
import { createDeleteCategory } from "./delete-category";
import type { CategoriesDeps } from "./deps";
import { createRenameCategoryGroup } from "./rename-category-group";
import { createRestoreCategory } from "./restore-category";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const asAna = { spaceId: "space-household", userId: "u-ana" };
const household = (archived: boolean) =>
  membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED", archived });

/** The repository calls in order, by method name; `lockTree` also names its space. */
const recording = (repository: CategoryRepository, calls: string[]): CategoryRepository =>
  new Proxy(repository, {
    get: (target, name) => {
      const member: unknown = Reflect.get(target, name);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        calls.push(name === "lockTree" ? `lockTree(${String(args[0])})` : String(name));
        return (member as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });

/** Household seeded in English with Restaurants archived (so RestoreCategory has work); its calls are recorded. */
const world = async (archived: boolean) => {
  const store = new InMemoryCategories();
  const calls: string[] = [];
  const shared = {
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    tm: memoryTm,
  };
  const setup: CategoriesDeps = { ...shared, categories: store, access: fakeSpaceAccess(household(false)) };
  unwrap(await createSeedDefaultCategories(setup)({ spaceId: "space-household", locale: "en" }));
  const named = (name: string) => store.categories.find((c) => c.name === name)!;
  unwrap(await createArchiveCategory(setup)({ ...asAna, categoryId: named("Restaurants").id }));
  const deps: CategoriesDeps = {
    ...shared,
    categories: recording(store, calls),
    access: fakeSpaceAccess(household(archived)),
  };
  return {
    calls,
    named,
    food: store.groups.find((g) => g.name === "Food")!,
    leisure: store.groups.find((g) => g.name === "Leisure")!,
    createGroup: createCreateCategoryGroup(deps),
    renameGroup: createRenameCategoryGroup(deps),
    create: createCreateCategory(deps),
    update: createUpdateCategory(deps),
    remove: createDeleteCategory({ ...deps, usage: { isCategoryReferenced: async () => false } }),
    archive: createArchiveCategory(deps),
    restore: createRestoreCategory(deps),
    archiveGroup: createArchiveCategoryGroup(deps),
  };
};
type World = Awaited<ReturnType<typeof world>>;

/** Every write to a space's category tree (seeding aside: it runs when the space is created). */
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

describe("writes to a space's category tree are serialized per space (ruling P90)", () => {
  it.each(WRITES)(
    "%s takes the lock of the space once, before it reads or writes anything",
    async (_name, write) => {
      const w = await world(false);
      expect(codeOf(await write(w))).toBe("ok");
      expect(w.calls[0]).toBe("lockTree(space-household)");
      expect(w.calls.filter((call) => call.startsWith("lockTree"))).toHaveLength(1);
    },
  );

  it.each(WRITES)(
    "%s queues no one behind a caller it refuses: the lock follows authorization",
    async (_name, write) => {
      const w = await world(true);
      expect(codeOf(await write(w))).toBe("SpaceArchived");
      expect(w.calls).toEqual([]);
    },
  );
});
