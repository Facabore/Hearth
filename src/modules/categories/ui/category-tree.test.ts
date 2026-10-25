import { describe, expect, it } from "vitest";
import { categoryDto, groupDto } from "../../../../tests/support/ui/dto";
import { activeTree, categoryPath, groupsForKind, matches } from "./category-tree";

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
