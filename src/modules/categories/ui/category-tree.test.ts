import { describe, expect, it } from "vitest";
import { categoryDto, groupDto } from "../../../../tests/support/ui/dto";
import {
  activeTree,
  categoryPath,
  groupsForKind,
  matches,
  withCategory,
  withGroup,
  withoutCategory,
} from "./category-tree";

const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  subcategories: [
    categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" }),
    categoryDto({
      id: "c-old",
      name: "Old",
      parentCategoryId: "c-groceries",
      archivedAt: "2026-10-01T00:00:00.000Z",
    }),
  ],
});
const groups = [
  groupDto({
    id: "g-food",
    name: "Food",
    categories: [
      groceries,
      categoryDto({ id: "c-gone", name: "Gone", archivedAt: "2026-10-01T00:00:00.000Z" }),
    ],
  }),
  groupDto({
    id: "g-closed",
    name: "Closed",
    archivedAt: "2026-10-01T00:00:00.000Z",
    categories: [categoryDto({ id: "c-x", name: "X" })],
  }),
];

describe("category tree (HU-E9-03)", () => {
  it("offers only live groups, categories and subcategories", () => {
    const tree = activeTree(groups);
    expect(tree.map((g) => g.name)).toEqual(["Food"]);
    expect(tree[0]!.categories.map((c) => [c.name, c.subcategories.map((s) => s.name)])).toEqual([
      ["Groceries", ["Vegetables"]],
    ]);
  });

  it("names a subcategory with its parent and finds archived ones for the history", () => {
    expect(categoryPath(groups, "c-veg")).toBe("Groceries › Vegetables");
    expect(categoryPath(groups, "c-groceries")).toBe("Groceries");
    expect(categoryPath(groups, "c-gone")).toBe("Gone");
    expect(categoryPath(groups, "c-missing")).toBeNull();
  });

  it("searches ignoring case and accents", () => {
    expect(matches("Alimentación", "alimentacion")).toBe(true);
    expect(matches("Mercado", "MERC")).toBe(true);
    expect(matches("Mercado", "pan")).toBe(false);
    expect(matches("Mercado", "  merc ")).toBe(true);
  });
});

describe("groupsForKind (issue #173)", () => {
  const food = groupDto({ id: "g-food", key: "food" });
  const income = groupDto({ id: "g-income", key: "income", name: "Ingresos" });
  const mine = groupDto({ id: "g-mine", key: null, name: "Mascotas" });
  const all = [food, income, mine];

  it("leaves the catalog's income group out of an expense", () => {
    expect(groupsForKind(all, "EXPENSE").map((g) => g.id)).toEqual(["g-food", "g-mine"]);
  });

  it("offers an income only the income group and the person's own groups", () => {
    expect(groupsForKind(all, "INCOME").map((g) => g.id)).toEqual(["g-income", "g-mine"]);
  });
});

describe("tree updates from what the API answered (HU-E9-04)", () => {
  // An answer carries no subcategories; the tree keeps the ones it has.
  const saved = { ...groceries, subcategories: undefined };
  const pantry = groupDto({ id: "g-pantry", name: "Pantry", key: null });
  const food = [groupDto({ categories: [groceries] })];

  it("adds a group last, with no categories", () => {
    expect(withGroup(food, pantry).map((g) => [g.name, g.categories.length])).toEqual([
      ["Food", 1],
      ["Pantry", 0],
    ]);
  });

  it("moves a category to another group with its subcategories, which take its style and group", () => {
    const moved = withCategory([...food, pantry], {
      ...saved,
      groupId: "g-pantry",
      icon: { kind: "EMOJI", value: "🛒" },
      color: "PLUM",
    });
    expect(moved[0]!.categories).toEqual([]);
    const [node] = moved[1]!.categories;
    expect(node!.subcategories.map((s) => [s.name, s.groupId, s.icon, s.color])).toEqual([
      ["Vegetables", "g-pantry", { kind: "EMOJI", value: "🛒" }, "PLUM"],
      ["Old", "g-pantry", { kind: "EMOJI", value: "🛒" }, "PLUM"],
    ]);
  });

  it("keeps a renamed category in its place, and archives its live subcategories with it", () => {
    const two = [groupDto({ categories: [groceries, categoryDto({ id: "c-dining", name: "Restaurants" })] })];
    const renamed = withCategory(two, { ...saved, name: "Market" });
    expect(renamed[0]!.categories.map((c) => c.name)).toEqual(["Market", "Restaurants"]);
    const archivedAt = "2026-10-26T00:00:00.000Z";
    const archived = withCategory(two, { ...saved, archivedAt });
    expect(archived[0]!.categories[0]!.subcategories.map((s) => s.archivedAt)).toEqual([
      archivedAt,
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("nests a new subcategory under its parent and drops a deleted one", () => {
    const added = withCategory(
      groups,
      categoryDto({ id: "c-meat", name: "Meat", parentCategoryId: "c-groceries" }),
    );
    expect(added[0]!.categories[0]!.subcategories.map((s) => s.name)).toEqual(["Vegetables", "Old", "Meat"]);
    expect(withoutCategory(added, "c-veg")[0]!.categories[0]!.subcategories.map((s) => s.name)).toEqual([
      "Old",
      "Meat",
    ]);
  });
});
