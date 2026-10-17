import { describe, expect, it } from "vitest";
import { mappable, rolledUpCategory, rolledUpSpending } from "./category-rollup";

const categories = [
  { id: "cat-groceries" },
  { id: "cat-vegetables", parentCategoryId: "cat-groceries" },
  { id: "cat-meat", parentCategoryId: "cat-groceries" },
  { id: "cat-restaurants", parentCategoryId: null },
];

describe("subcategory roll-up (HU-E3-04)", () => {
  it("counts a subcategory as its parent and anything else as itself", () => {
    expect(rolledUpCategory("cat-vegetables", categories)).toBe("cat-groceries");
    expect(rolledUpCategory("cat-groceries", categories)).toBe("cat-groceries");
    expect(rolledUpCategory("cat-unknown", categories)).toBe("cat-unknown");
  });

  it("sums the spending of Vegetables and Meat into Groceries, first seen first", () => {
    expect(
      rolledUpSpending(
        [
          { categoryId: "cat-vegetables", amount: 4_000_000n },
          { categoryId: "cat-restaurants", amount: 6_000_000n },
          { categoryId: "cat-meat", amount: 6_000_000n },
          { categoryId: "cat-groceries", amount: 8_500_000n },
        ],
        categories,
      ),
    ).toEqual([
      { categoryId: "cat-groceries", amount: 18_500_000n },
      { categoryId: "cat-restaurants", amount: 6_000_000n },
    ]);
  });

  it("maps only categories directly in their group", () => {
    expect(mappable(categories).map((c) => c.id)).toEqual(["cat-groceries", "cat-restaurants"]);
  });
});
