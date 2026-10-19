import { describe, expect, it } from "vitest";
import { FOOD, HOUSEHOLD_TREE, node } from "../../../../tests/support/category-trees";
import { placeIn, treeById } from "./category-tree";

const tree = treeById(HOUSEHOLD_TREE);

describe("where spending counts in a category tree (HU-E3-04, HU-E7-06)", () => {
  it("places spending recorded in a category in that category, with no subcategory", () => {
    expect(placeIn(tree, "cat-groceries")).toEqual({
      category: tree.get("cat-groceries"),
      subcategory: null,
    });
  });

  it("rolls spending recorded in a subcategory up into its category, keeping the subcategory", () => {
    expect(placeIn(tree, "cat-vegetables")).toEqual({
      category: tree.get("cat-groceries"),
      subcategory: tree.get("cat-vegetables"),
    });
  });

  it("has no place for a category the tree does not hold", () => {
    expect(placeIn(tree, "cat-unknown")).toBeNull();
  });

  it("keeps counting a subcategory in its category once that category is archived", () => {
    const archived = treeById([
      node(FOOD, "cat-groceries", "Groceries", { key: "groceries", archived: true }),
      node(FOOD, "cat-vegetables", "Vegetables", { parent: "cat-groceries" }),
    ]);
    expect(placeIn(archived, "cat-vegetables")).toEqual({
      category: archived.get("cat-groceries"),
      subcategory: archived.get("cat-vegetables"),
    });
  });

  it("rolls a seeded category moved under another into it, whatever catalog key it keeps (spec 5.2)", () => {
    const moved = treeById([
      node(FOOD, "cat-groceries", "Groceries", { key: "groceries" }),
      node(FOOD, "cat-restaurants", "Restaurants", { key: "restaurants", parent: "cat-groceries" }),
    ]);
    expect(placeIn(moved, "cat-restaurants")).toEqual({
      category: moved.get("cat-groceries"),
      subcategory: moved.get("cat-restaurants"),
    });
  });

  it("counts a subcategory whose parent the tree lacks as a category of its own", () => {
    const orphan = treeById([node(FOOD, "cat-vegetables", "Vegetables", { parent: "cat-groceries" })]);
    expect(placeIn(orphan, "cat-vegetables")).toEqual({
      category: orphan.get("cat-vegetables"),
      subcategory: null,
    });
  });
});
