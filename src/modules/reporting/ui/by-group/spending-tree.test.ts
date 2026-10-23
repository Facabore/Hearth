import { describe, expect, it } from "vitest";
import type { PersonalSpendingByGroupDto } from "@/shared/ui/api/dto";
import { cop } from "../../../../../tests/support/ui/dto";
import { e7Groups } from "../../../../../tests/support/ui/plan-dto";
import { levelAt, treeOf } from "./spending-tree";

describe("spending tree (HU-E9-10, ruling P215)", () => {
  const tree = treeOf(e7Groups().groups);

  it("keeps the API's order, totals and shares at every level", () => {
    expect(tree.map((n) => [n.id, n.name, n.total.amount, n.share])).toEqual([
      ["g:g-housing", { kind: "plain", name: "Housing" }, "160000000", "56.94"],
      ["g:g-food", { kind: "plain", name: "Food" }, "96000000", "34.16"],
      ["g:g-leisure", { kind: "plain", name: "Leisure" }, "25000000", "8.90"],
    ]);
  });

  it("goes down to the subcategories only where there is a named one", () => {
    const food = levelAt(tree, ["g:g-food"]);
    expect(food.node?.name).toEqual({ kind: "plain", name: "Food" });
    expect(food.rows.map((n) => [n.name, n.children.length])).toEqual([
      [{ kind: "plain", name: "Groceries" }, 3],
      [{ kind: "plain", name: "Restaurants" }, 0],
    ]);
    const groceries = levelAt(tree, ["g:g-food", "c:c-groceries"]);
    expect(groceries.rows.map((n) => [n.name, n.share])).toEqual([
      [{ kind: "noSubcategory" }, "50.00"],
      [{ kind: "plain", name: "Vegetables" }, "30.00"],
      [{ kind: "plain", name: "Meat" }, "20.00"],
    ]);
    expect(groceries.trail.map((n) => n.id)).toEqual(["g:g-food", "c:c-groceries"]);
    expect(levelAt(tree, []).rows).toBe(tree);
  });

  it("stops at the deepest level a stale path still names, and at the root for a path that names none", () => {
    expect(levelAt(tree, ["g:g-food", "c:gone", "s:c-veg"]).trail.map((n) => n.id)).toEqual(["g:g-food"]);
    const lost = levelAt(tree, ["g:gone"]);
    expect([lost.node, lost.trail]).toEqual([null, []]);
    expect(lost.rows).toBe(tree);
    // A leaf opens nothing: a path that names one stops above it, so a level is never an empty list.
    const leaf = levelAt(tree, ["g:g-leisure", "c:c-fun", "s:none"]);
    expect(leaf.trail.map((n) => n.id)).toEqual(["g:g-leisure"]);
    expect(leaf.rows.map((n) => n.id)).toEqual(["c:c-fun"]);
  });

  it("names a merged personal node by its catalog key, and scopes a custom one to its space", () => {
    const personal: PersonalSpendingByGroupDto["groups"] = [
      {
        id: null,
        key: "food",
        name: "Comida",
        archived: false,
        total: cop(100),
        share: "100.00",
        space: null,
        categories: [
          {
            id: null,
            key: "pets",
            name: "Mascotas",
            archived: false,
            total: cop(100),
            share: "100.00",
            space: { id: "sp-home", name: "Hogar" },
            subcategories: [
              {
                subcategoryId: "sub-vet",
                name: "Veterinario",
                archived: true,
                total: cop(100),
                share: "100.00",
                space: { id: "sp-home", name: "Hogar" },
              },
            ],
          },
        ],
      },
    ];
    const [food] = treeOf(personal);
    expect(food?.id).toBe("g:key:food");
    expect(food?.name).toEqual({ kind: "plain", name: "Comida" });
    const pets = food?.children[0];
    expect(pets?.id).toBe("c:key:pets");
    expect(pets?.name).toEqual({ kind: "scoped", space: "Hogar", name: "Mascotas" });
    expect(pets?.children[0]).toMatchObject({
      id: "s:sub-vet",
      name: { kind: "scoped", space: "Hogar", name: "Veterinario" },
      archived: true,
    });
  });
});
