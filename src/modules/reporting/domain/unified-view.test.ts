import { describe, expect, it } from "vitest";
import { node, spent } from "../../../../tests/support/category-trees";
import { spendingTree } from "./spending-by-group";
import { cashOutOf, consumptionGroups, type ConsumptionCategory } from "./unified-view";

const pesos = (n: number) => BigInt(n) * 100n;
const category = (
  spaceId: string,
  id: string,
  name: string,
  key: string | null = null,
  parentCategoryId: string | null = null,
): ConsumptionCategory => ({ spaceId, id, key, name, parentCategoryId });
const CATEGORIES: readonly ConsumptionCategory[] = [
  category("space-ana", "cat-ana-groceries", "Groceries", "groceries"),
  category("space-ana", "cat-ana-restaurants", "Restaurants", "restaurants"),
  category("space-ana", "cat-ana-pets", "Pets"),
  category("space-ana", "cat-ana-verduras", "Verduras", null, "cat-ana-groceries"),
  // A seeded Rent moved under Groceries keeps its catalog key (spec 5.2).
  category("space-ana", "cat-ana-rent", "Habitación", "rent", "cat-ana-groceries"),
  category("space-household", "cat-groceries", "Mercado", "groceries"),
  category("space-household", "cat-rent", "Arriendo", "rent"),
  category("space-household", "cat-pets", "Pets"),
  category("space-household", "cat-vet", "Vet", null, "cat-pets"),
  category("space-trip", "cat-trip-rent", "Cabin", "rent"),
];
const NAMING = {
  personalSpaceId: "space-ana",
  spaceNames: new Map([
    ["space-ana", "Personal"],
    ["space-household", "Household"],
    ["space-trip", "Trip"],
  ]),
};

describe("unified personal view (HU-E7-04, D11)", () => {
  it("groups seeded categories of every space under their catalog key, the largest first", () => {
    const rows = [
      { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(85_000) },
      { spaceId: "space-ana", categoryId: "cat-ana-restaurants", amount: pesos(60_000) },
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(950_000) },
      { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(480_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING)).toEqual([
      { key: "groceries", name: "Groceries", spaceId: null, categoryId: null, amount: pesos(1_035_000) },
      { key: "rent", name: "Arriendo", spaceId: null, categoryId: null, amount: pesos(480_000) },
      { key: "restaurants", name: "Restaurants", spaceId: null, categoryId: null, amount: pesos(60_000) },
    ]);
  });

  it("keeps custom categories apart, one group per space and category", () => {
    const rows = [
      { spaceId: "space-ana", categoryId: "cat-ana-pets", amount: pesos(30_000) },
      { spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING)).toEqual([
      { key: null, name: "Pets", spaceId: "space-ana", categoryId: "cat-ana-pets", amount: pesos(30_000) },
      { key: null, name: "Pets", spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ]);
  });

  it("rolls a subcategory up into its category: under the parent's key, or into the parent's custom row (HU-E3-04)", () => {
    const rows = [
      { spaceId: "space-ana", categoryId: "cat-ana-verduras", amount: pesos(20_000) },
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(100_000) },
      { spaceId: "space-household", categoryId: "cat-vet", amount: pesos(25_000) },
      { spaceId: "space-household", categoryId: "cat-pets", amount: pesos(5_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING)).toEqual([
      { key: "groceries", name: "Groceries", spaceId: null, categoryId: null, amount: pesos(120_000) },
      { key: null, name: "Pets", spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ]);
  });

  it("names a merged group as the personal space does, else as the space spending most in it (ruling P76)", () => {
    const rows = [
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(900_000) },
      { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(100_000) },
      { spaceId: "space-trip", categoryId: "cat-trip-rent", amount: pesos(300_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING).map((g) => [g.key, g.name])).toEqual([
      ["groceries", "Groceries"],
      ["rent", "Cabin"],
    ]);
  });

  it("counts a seeded category moved under another in its parent's key, and never lets it name its own key (spec 5.2, P95)", () => {
    const rows = [
      { spaceId: "space-ana", categoryId: "cat-ana-rent", amount: pesos(40_000) },
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(100_000) },
      { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(100_000) },
      { spaceId: "space-trip", categoryId: "cat-trip-rent", amount: pesos(300_000) },
    ];
    expect(consumptionGroups(rows, CATEGORIES, NAMING)).toEqual([
      // The personal Rent is a subcategory of Groceries: it neither adds to nor names the `rent` group.
      { key: "rent", name: "Cabin", spaceId: null, categoryId: null, amount: pesos(400_000) },
      { key: "groceries", name: "Groceries", spaceId: null, categoryId: null, amount: pesos(140_000) },
    ]);
  });

  it("breaks a tie between spaces spending the same in a group by space name when the personal space has none (P95)", () => {
    const rows = [
      { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(100_000) },
      { spaceId: "space-trip", categoryId: "cat-trip-rent", amount: pesos(100_000) },
    ];
    const naming = {
      personalSpaceId: "space-ana",
      spaceNames: new Map([
        ["space-household", "Zeta"],
        ["space-trip", "Alpha"],
      ]),
    };
    expect(consumptionGroups(rows, CATEGORIES, naming).map((g) => g.name)).toEqual(["Cabin"]);
  });

  it("adds payments, fund contributions and savings transfers into cash out, with what left outside the app", () => {
    const sums = {
      payments: pesos(2_145_000),
      paymentsOutsideTheApp: pesos(30_000),
      fundContributions: pesos(480_000),
      contributionsOutsideTheApp: pesos(20_000),
    };
    expect(cashOutOf(sums, pesos(200_000))).toEqual({
      total: pesos(2_825_000),
      payments: pesos(2_145_000),
      fundContributions: pesos(480_000),
      savingsTransfers: pesos(200_000),
      outsideTheApp: pesos(50_000),
    });
  });
});

describe("one naming tie-break for every personal report (ruling P106)", () => {
  // Groceries spent equally in two spaces, neither of them the personal one, so the tie-break names the row.
  it.each([
    ["casa", "Departamento", "Mercado"],
    ["Ezequiel", "Éxito", "Supermercado"],
    // Equal once case is ignored: the space id decides.
    ["casa", "Casa", "Mercado"],
  ])(
    "names the row as the space that collates first, %s or %s, in the unified view and the breakdown alike",
    (xName, yName, expected) => {
      const spaceNames = new Map([
        ["space-ana", "Personal"],
        ["space-x", xName],
        ["space-y", yName],
      ]);
      const rows = [spent("space-x", "cat-x-groceries", 10_000), spent("space-y", "cat-y-groceries", 10_000)];
      const unified = consumptionGroups(
        rows,
        [
          category("space-x", "cat-x-groceries", "Mercado", "groceries"),
          category("space-y", "cat-y-groceries", "Supermercado", "groceries"),
        ],
        { personalSpaceId: "space-ana", spaceNames },
      );
      const breakdown = spendingTree(
        rows,
        [
          node(
            { spaceId: "space-x", id: "grp-x-food", name: "Food", key: "food" },
            "cat-x-groceries",
            "Mercado",
            {
              key: "groceries",
            },
          ),
          node(
            { spaceId: "space-y", id: "grp-y-food", name: "Food", key: "food" },
            "cat-y-groceries",
            "Supermercado",
            { key: "groceries" },
          ),
        ],
        { kind: "PERSONAL", personalSpaceId: "space-ana", spaceNames, personalGroups: [] },
      );
      expect(unified.map((g) => g.name)).toEqual([expected]);
      expect(breakdown.groups[0]!.categories.map((c) => c.name)).toEqual([expected]);
    },
  );
});
