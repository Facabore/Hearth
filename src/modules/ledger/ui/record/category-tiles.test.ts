import { describe, expect, it } from "vitest";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { tileIds } from "./category-tiles";

const category = (id: string, key: string | null) => ({ id, key, subcategories: [] });
const group = (categories: ReturnType<typeof category>[]) => ({ categories }) as unknown as CategoryGroupDto;

/** The seeded tree in its order: housing first, as a new person's starter categories come (audit pass 3, A14). */
const tree = [
  group([
    category("rent", "rent"),
    category("maintenance", "maintenance"),
    category("utilities", "utilities"),
  ]),
  group([category("groceries", "groceries"), category("restaurants", "restaurants")]),
  group([category("fuel", "fuel"), category("bus", "public_transport")]),
  group([category("mine", null)]),
];

describe("the record form's three category tiles (#289)", () => {
  it("with nothing recent, offers the everyday categories first, not the tree's first group", () => {
    expect(tileIds(tree, [], null)).toEqual(["groceries", "restaurants", "bus"]);
  });

  it("keeps the chosen one and the recent ones before the everyday ones", () => {
    expect(tileIds(tree, [{ categoryId: "fuel", subcategoryId: null }], "rent")).toEqual([
      "rent",
      "fuel",
      "groceries",
    ]);
  });

  it("falls back to the tree's order where the space has none of the everyday categories", () => {
    expect(tileIds([group([category("a", null), category("b", null)])], [], null)).toEqual(["a", "b"]);
  });

  it("offers the salary first on an income", () => {
    const income = [group([category("other", "other_income"), category("salary", "salary")])];
    expect(tileIds(income, [], null)).toEqual(["salary", "other"]);
  });
});
