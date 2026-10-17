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
import { createCreateCategoryGroup } from "./create-category-group";
import type { CategoriesDeps } from "./deps";
import { createListCategories } from "./list-categories";
import { createRenameCategoryGroup } from "./rename-category-group";
import { createRestoreCategory } from "./restore-category";
import { createSeedDefaultCategories } from "./seed-default-categories";
import { createUpdateCategory } from "./update-category";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
const cart = { icon: { kind: "SYMBOL", name: "cart" }, color: "SAND" } as const;
const apple = { icon: { kind: "SYMBOL", name: "apple" }, color: "SAND" } as const;
const emoji = { kind: "EMOJI", value: "🛒" } as const;

/** Ana's personal space, seeded in English: "Groceries" and "Restaurants" in "Food". */
const setup = async () => {
  const categories = new InMemoryCategories();
  const deps: CategoriesDeps = {
    categories,
    access: fakeSpaceAccess(membership()),
    ids: sequentialIds("cat"),
    clock: new FixedClock(new Date("2026-10-16T12:00:00Z")),
    tm: memoryTm,
  };
  unwrap(await createSeedDefaultCategories(deps)({ spaceId: "space-ana", locale: "en" }));
  return {
    named: (name: string) => categories.categories.find((c) => c.name === name)!,
    group: (name: string) => categories.groups.find((g) => g.name === name)!,
    /** Everything stored right now; rows are replaced on a save, never edited, so a copy of the lists stays as it was. */
    stored: () => ({ groups: [...categories.groups], categories: [...categories.categories] }),
    create: createCreateCategory(deps),
    update: createUpdateCategory(deps),
    createGroup: createCreateCategoryGroup(deps),
    renameGroup: createRenameCategoryGroup(deps),
    list: createListCategories(deps),
    archive: createArchiveCategory(deps),
    restore: createRestoreCategory(deps),
  };
};

describe("category icon and color (HU-E3-05)", () => {
  it("starts seeded and new categories with a default style, copied from the group at creation", async () => {
    const w = await setup();
    expect([w.group("Food").style, w.named("Groceries").style]).toEqual([apple, cart]);
    const bakery = unwrap(await w.create({ ...asAna, groupId: w.group("Food").id, name: "Bakery" }));
    expect(bakery.shown).toEqual(apple);
    unwrap(await w.renameGroup({ ...asAna, groupId: w.group("Food").id, color: "EMBER" }));
    expect(w.named("Bakery").style).toEqual(apple);
  });

  it("creates a category with its own icon and color over its group's, part by part", async () => {
    const w = await setup();
    const food = w.group("Food").id;
    const bakery = unwrap(
      await w.create({ ...asAna, groupId: food, name: "Bakery", icon: emoji, color: "ROSE" }),
    );
    expect([bakery.style, bakery.shown]).toEqual([
      { icon: emoji, color: "ROSE" },
      { icon: emoji, color: "ROSE" },
    ]);
    const butcher = unwrap(await w.create({ ...asAna, groupId: food, name: "Butcher", color: "EMBER" }));
    expect(butcher.shown).toEqual({ icon: apple.icon, color: "EMBER" });
    const deli = unwrap(
      await w.create({ ...asAna, groupId: food, name: "Deli", icon: { kind: "SYMBOL", name: "pizza" } }),
    );
    expect(deli.shown).toEqual({ icon: { kind: "SYMBOL", name: "pizza" }, color: "SAND" });
  });

  it("gives a seeded group its catalog key and a group users create none, and keeps the key through a rename and a restyle", async () => {
    const w = await setup();
    const food = w.group("Food").id;
    expect(w.group("Food").key).toBe("food");
    unwrap(await w.renameGroup({ ...asAna, groupId: food, name: "Eating", color: "EMBER" }));
    expect([w.group("Eating").key, w.group("Eating").style.color]).toEqual(["food", "EMBER"]);
    expect(unwrap(await w.createGroup({ ...asAna, name: "Pets" })).key).toBeNull();
  });

  it("changes a category's icon and color, never its group's, and a symbol or an emoji replaces the other", async () => {
    const w = await setup();
    const groceries = w.named("Groceries").id;
    const changed = await w.update({
      ...asAna,
      categoryId: groceries,
      icon: { kind: "SYMBOL", name: "bread" },
      color: "ROSE",
    });
    expect(unwrap(changed).shown).toEqual({ icon: { kind: "SYMBOL", name: "bread" }, color: "ROSE" });
    expect(w.group("Food").style).toEqual(apple);
    unwrap(await w.update({ ...asAna, categoryId: groceries, icon: emoji }));
    expect(w.named("Groceries").style).toEqual({ icon: emoji, color: "ROSE" });
  });

  it.each([
    [{ kind: "SYMBOL", name: "unicorn" }],
    [{ kind: "EMOJI", value: "🛒🍞" }],
    [{ kind: "EMOJI", value: "a" }],
  ] as const)("refuses the icon %o with InvalidCategoryIcon and changes nothing", async (icon) => {
    const w = await setup();
    const before = w.stored();
    const food = w.group("Food").id;
    const groceries = w.named("Groceries").id;
    const refused = [
      await w.createGroup({ ...asAna, name: "Pets", icon }),
      await w.renameGroup({ ...asAna, groupId: food, name: "Eating", icon }),
      await w.create({ ...asAna, groupId: food, name: "Bakery", icon }),
      await w.update({ ...asAna, categoryId: groceries, name: "Market", icon, color: "ROSE" }),
    ];
    expect(refused.map(codeOf)).toEqual(Array(4).fill("InvalidCategoryIcon"));
    // A name sent with the bad icon is not applied either: nothing was added, renamed or restyled.
    expect(w.stored()).toEqual(before);
  });

  it("shows a subcategory with its parent's style, which it follows, and refuses one of its own", async () => {
    const w = await setup();
    const groceries = w.named("Groceries").id;
    const vegetables = unwrap(await w.create({ ...asAna, parentCategoryId: groceries, name: "Vegetables" }));
    expect([vegetables.style, vegetables.shown]).toEqual([null, cart]);
    unwrap(await w.update({ ...asAna, categoryId: groceries, icon: emoji, color: "PLUM" }));
    const food = unwrap(await w.list({ ...asAna, includeArchived: false })).find((g) => g.name === "Food")!;
    const node = food.categories.find((c) => c.id === groceries)!;
    expect(node.subcategories.map((s) => [s.name, s.shown])).toEqual([
      ["Vegetables", { icon: emoji, color: "PLUM" }],
    ]);
    expect(codeOf(await w.update({ ...asAna, categoryId: vegetables.id, color: "ROSE" }))).toBe(
      "ValidationFailed",
    );
    const meat = await w.create({ ...asAna, parentCategoryId: groceries, name: "Meat", color: "ROSE" });
    expect(codeOf(meat)).toBe("ValidationFailed");
  });

  it("keeps a copy of the parent's style when a subcategory becomes a category, or takes the one sent with it", async () => {
    const w = await setup();
    const food = w.group("Food").id;
    const groceries = w.named("Groceries").id;
    unwrap(await w.update({ ...asAna, categoryId: groceries, icon: emoji, color: "PLUM" }));
    const vegetables = unwrap(await w.create({ ...asAna, parentCategoryId: groceries, name: "Vegetables" }));
    const promoted = unwrap(
      await w.update({ ...asAna, categoryId: vegetables.id, parentCategoryId: null, groupId: food }),
    );
    expect([promoted.parentCategoryId, promoted.style]).toEqual([null, { icon: emoji, color: "PLUM" }]);
    unwrap(await w.update({ ...asAna, categoryId: groceries, color: "SAGE" }));
    expect(w.named("Vegetables").style).toEqual({ icon: emoji, color: "PLUM" });

    // Ruling P58: the refusal judges the result, so a PATCH that makes it a category may restyle it in the same request.
    const fruit = unwrap(await w.create({ ...asAna, parentCategoryId: groceries, name: "Fruit" }));
    const own = { icon: { kind: "SYMBOL", name: "apple" }, color: "TEAL" } as const;
    const restyled = unwrap(
      await w.update({ ...asAna, categoryId: fruit.id, parentCategoryId: null, groupId: food, ...own }),
    );
    expect([restyled.parentCategoryId, restyled.style, restyled.shown]).toEqual([null, own, own]);
    expect(w.named("Fruit").style).toEqual(own);
  });

  it("creates groups with or without a style, and restyles one without renaming it", async () => {
    const w = await setup();
    expect(unwrap(await w.createGroup({ ...asAna, name: "Pets" })).style).toEqual({
      icon: { kind: "SYMBOL", name: "tag" },
      color: "GRAPHITE",
    });
    const kids = unwrap(
      await w.createGroup({ ...asAna, name: "Kids", icon: { kind: "SYMBOL", name: "users" } }),
    );
    const restyled = unwrap(await w.renameGroup({ ...asAna, groupId: kids.id, color: "PINE" }));
    expect([restyled.name, restyled.style]).toEqual([
      "Kids",
      { icon: { kind: "SYMBOL", name: "users" }, color: "PINE" },
    ]);
  });

  it("answers archiving and restoring a subcategory with its parent's style", async () => {
    const w = await setup();
    const groceries = w.named("Groceries").id;
    const vegetables = unwrap(await w.create({ ...asAna, parentCategoryId: groceries, name: "Vegetables" }));
    const archived = unwrap(await w.archive({ ...asAna, categoryId: vegetables.id }));
    expect([archived.style, archived.shown]).toEqual([null, cart]);
    const restored = unwrap(await w.restore({ ...asAna, categoryId: vegetables.id }));
    expect([restored.style, restored.shown]).toEqual([null, cart]);
  });
});
