import { describe, expect, it } from "vitest";
import {
  ANA_FOOD,
  ANA_TREE,
  groupsIn,
  HOUSEHOLD_TREE,
  LEISURE,
  node,
  PETS,
  spent,
} from "../../../../tests/support/category-trees";
import type { TreeGroup } from "./category-tree";
import { shareOf, spendingTree, type Grouping } from "./spending-by-group";

const pesos = (n: number) => BigInt(n) * 100n;
const inHousehold = (categoryId: string, amount: number) => spent("space-household", categoryId, amount);
const atHome = (categoryId: string, amount: number) => spent("space-ana", categoryId, amount);
const SPACE: Grouping = { kind: "SPACE" };
const PERSONAL: Grouping = {
  kind: "PERSONAL",
  personalSpaceId: "space-ana",
  spaceNames: new Map([
    ["space-ana", "Personal"],
    ["space-household", "Household"],
    ["space-trip", "Trip"],
  ]),
  personalGroups: groupsIn(ANA_TREE),
};

/** HU-E7-01 Background: Household's November 2026 by category, as the ledger sums it. */
const november = () => [
  inHousehold("cat-rent", 1_200_000),
  inHousehold("cat-groceries", 900_000),
  inHousehold("cat-utilities", 400_000),
  inHousehold("cat-entertainment", 250_000),
  inHousehold("cat-restaurants", 60_000),
];
const figures = (nodes: readonly { name: string | null; total: bigint; share: number }[]) =>
  nodes.map((n) => [n.name, n.total, n.share]);
/** Household's tree after Ana moved Restaurants from Food to Leisure (HU-E3-02). */
const moved = HOUSEHOLD_TREE.map((n) =>
  n.categoryId === "cat-restaurants"
    ? node(LEISURE, "cat-restaurants", "Restaurants", { key: "restaurants" })
    : n,
);

describe("spending by category group (HU-E7-06)", () => {
  it("totals a space's spending by group, the largest first, each a share of the period's total (@critical)", () => {
    const tree = spendingTree(november(), HOUSEHOLD_TREE, SPACE);
    expect(tree.total).toBe(pesos(2_810_000));
    // Transport and Pets have no spending, so they are not listed.
    expect(tree.groups.map((g) => [g.id, g.key, g.name, g.space, g.total, g.share])).toEqual([
      ["grp-housing", "housing", "Housing", null, pesos(1_600_000), 5_694],
      ["grp-food", "food", "Food", null, pesos(960_000), 3_416],
      ["grp-leisure", "leisure", "Leisure", null, pesos(250_000), 890],
    ]);
  });

  it("drills down from Food to its categories and from Groceries to its subcategories", () => {
    const spending = [
      ...november().filter((row) => row.categoryId !== "cat-groceries"),
      inHousehold("cat-groceries", 450_000),
      inHousehold("cat-vegetables", 270_000),
      inHousehold("cat-meat", 180_000),
    ];
    const food = spendingTree(spending, HOUSEHOLD_TREE, SPACE).groups.find((g) => g.key === "food")!;
    expect(figures(food.categories)).toEqual([
      ["Groceries", pesos(900_000), 9_375],
      ["Restaurants", pesos(60_000), 625],
    ]);
    expect(food.categories.map((c) => [c.id, c.key, c.space])).toEqual([
      ["cat-groceries", "groceries", null],
      ["cat-restaurants", "restaurants", null],
    ]);
    expect(food.categories[0]!.subcategories.map((s) => [s.subcategoryId, s.name, s.total, s.share])).toEqual(
      [
        [null, null, pesos(450_000), 5_000],
        ["cat-vegetables", "Vegetables", pesos(270_000), 3_000],
        ["cat-meat", "Meat", pesos(180_000), 2_000],
      ],
    );
    // Restaurants has no subcategory with spending, so it lists none.
    expect(food.categories[1]!.subcategories).toEqual([]);
  });

  it("counts an expense in a subcategory once, in its category and in its group", () => {
    const spending = [
      inHousehold("cat-groceries", 85_000),
      inHousehold("cat-vegetables", 40_000),
      inHousehold("cat-restaurants", 60_000),
    ];
    const tree = spendingTree(spending, HOUSEHOLD_TREE, SPACE);
    expect(tree.total).toBe(pesos(185_000));
    expect(figures(tree.groups)).toEqual([["Food", pesos(185_000), 10_000]]);
    const groceries = tree.groups[0]!.categories[0]!;
    expect([groceries.name, groceries.total]).toEqual(["Groceries", pesos(125_000)]);
    expect(groceries.subcategories.map((s) => [s.name, s.total])).toEqual([
      [null, pesos(85_000)],
      ["Vegetables", pesos(40_000)],
    ]);
  });

  it("reads the tree as it is now, so a moved category counts under its new group in every period", () => {
    expect(figures(spendingTree(november(), moved, SPACE).groups)).toEqual([
      ["Housing", pesos(1_600_000), 5_694],
      ["Food", pesos(900_000), 3_203],
      ["Leisure", pesos(310_000), 1_103],
    ]);
    const october = spendingTree([inHousehold("cat-restaurants", 30_000)], moved, SPACE);
    expect(october.groups.map((g) => [g.key, g.categories.map((c) => c.key)])).toEqual([
      ["leisure", ["restaurants"]],
    ]);
  });

  it("orders equal totals by name ignoring case, the spending without a subcategory last, and flags archived nodes", () => {
    const auto = { spaceId: "space-household", id: "grp-auto", name: "Auto" };
    const bills = { spaceId: "space-household", id: "grp-bills", name: "bills", archived: true };
    const nodes = [
      ...HOUSEHOLD_TREE,
      node(auto, "cat-car", "Car"),
      node(bills, "cat-water", "water", { archived: true }),
    ];
    const spending = [
      inHousehold("cat-water", 20_000),
      inHousehold("cat-car", 20_000),
      inHousehold("cat-groceries", 10_000),
      inHousehold("cat-meat", 10_000),
    ];
    const tree = spendingTree(spending, nodes, SPACE);
    expect(tree.groups.map((g) => [g.name, g.archived])).toEqual([
      ["Auto", false],
      ["bills", true],
      ["Food", false],
    ]);
    expect(tree.groups[1]!.categories[0]).toMatchObject({ name: "water", archived: true });
    expect(tree.groups[2]!.categories[0]!.subcategories.map((s) => s.name)).toEqual(["Meat", null]);
  });

  it("orders equal totals as Spanish does: case ignored, accents kept, n before ñ (ruling P82)", () => {
    // The ids oppose the names, so only the collation decides.
    const group = (id: string, name: string) => ({ spaceId: "space-household", id, name });
    const nodes = [
      node(group("grp-1", "Ñoquis"), "cat-1", "One"),
      node(group("grp-2", "Nueces"), "cat-2", "Two"),
      node(group("grp-3", "Café"), "cat-3", "Three"),
      node(group("grp-4", "Cafe"), "cat-4", "Four"),
    ];
    const spending = ["cat-1", "cat-2", "cat-3", "cat-4"].map((id) => inHousehold(id, 10_000));
    expect(spendingTree(spending, nodes, SPACE).groups.map((g) => g.name)).toEqual([
      "Cafe",
      "Café",
      "Nueces",
      "Ñoquis",
    ]);
  });

  it("breaks a tie of equal totals and names by the name of the space, then by id (ruling P82)", () => {
    const pets = (spaceId: string, id: string) => ({ spaceId, id, name: "Pets" });
    const nodes = [
      node(pets("space-household", "grp-z"), "cat-h1", "Vet"),
      node(pets("space-household", "grp-y"), "cat-h2", "Vet"),
      node(pets("space-ana", "grp-a"), "cat-a", "Vet"),
    ];
    const spending = [inHousehold("cat-h1", 10_000), inHousehold("cat-h2", 10_000), atHome("cat-a", 10_000)];
    // The ids put Ana's first; the name of her space ("Personal") puts it after Household's.
    expect(spendingTree(spending, nodes, PERSONAL).groups.map((g) => [g.space?.name, g.id])).toEqual([
      ["Household", "grp-y"],
      ["Household", "grp-z"],
      ["Personal", "grp-a"],
    ]);
  });

  it("answers 0 and no groups without spending, and leaves out what the tree does not hold", () => {
    expect(spendingTree([], HOUSEHOLD_TREE, SPACE)).toEqual({ total: 0n, groups: [] });
    expect(spendingTree([inHousehold("cat-unknown", 5_000)], HOUSEHOLD_TREE, SPACE)).toEqual({
      total: 0n,
      groups: [],
    });
  });

  it("leaves out a row of 0, so a category or a subcategory without spending is not listed", () => {
    const spending = [
      inHousehold("cat-groceries", 0),
      inHousehold("cat-vegetables", 0),
      inHousehold("cat-meat", 30_000),
      inHousehold("cat-restaurants", 0),
      inHousehold("cat-rent", 0),
    ];
    const tree = spendingTree(spending, HOUSEHOLD_TREE, SPACE);
    expect(figures(tree.groups)).toEqual([["Food", pesos(30_000), 10_000]]);
    expect(figures(tree.groups[0]!.categories)).toEqual([["Groceries", pesos(30_000), 10_000]]);
    // The 0 spent in Groceries itself and in Vegetables lists neither; only Meat does, so the 0 entry is absent too.
    expect(figures(tree.groups[0]!.categories[0]!.subcategories)).toEqual([["Meat", pesos(30_000), 10_000]]);
    expect(spendingTree([inHousehold("cat-rent", 0)], HOUSEHOLD_TREE, SPACE)).toEqual({
      total: 0n,
      groups: [],
    });
  });

  it("rounds each share half up on its own level, so siblings may add up to 99.99 or 100.01", () => {
    expect([shareOf(1n, 3n), shareOf(1n, 3n), shareOf(1n, 3n)]).toEqual([3_333, 3_333, 3_333]);
    expect([shareOf(1n, 6n), shareOf(1n, 6n), shareOf(4n, 6n)]).toEqual([1_667, 1_667, 6_667]);
    expect(shareOf(1n, 20_000n)).toBe(1);
    expect(shareOf(1n, 20_001n)).toBe(0);
    expect(shareOf(0n, 0n)).toBe(0);
  });

  it("merges seeded groups and categories across spaces by catalog key and keeps each custom group with its space (@critical)", () => {
    // HU-E7-04 Background as Ana's shares, her 40,000 COP Vet at home and her 25,000 COP share of Household's Vet.
    const spending = [
      atHome("cat-ana-groceries", 85_000),
      atHome("cat-ana-restaurants", 60_000),
      inHousehold("cat-groceries", 950_000),
      inHousehold("cat-rent", 480_000),
      atHome("cat-ana-vet", 40_000),
      inHousehold("cat-vet", 25_000),
    ];
    const tree = spendingTree(spending, [...ANA_TREE, ...HOUSEHOLD_TREE], PERSONAL);
    expect(tree.total).toBe(pesos(1_640_000));
    expect(tree.groups.map((g) => [g.name, g.key, g.id, g.space, g.total, g.share])).toEqual([
      ["Food", "food", null, null, pesos(1_095_000), 6_677],
      ["Housing", "housing", null, null, pesos(480_000), 2_927],
      ["Pets", null, "grp-ana-pets", { id: "space-ana", name: "Personal" }, pesos(40_000), 244],
      ["Pets", null, "grp-pets", { id: "space-household", name: "Household" }, pesos(25_000), 152],
    ]);
    expect(tree.groups[0]!.categories.map((c) => [c.key, c.id, c.space, c.total])).toEqual([
      ["groceries", null, null, pesos(1_035_000)],
      ["restaurants", null, null, pesos(60_000)],
    ]);
    // A custom category keeps its id and its space, like the custom group it sits in.
    expect(tree.groups[2]!.categories.map((c) => [c.id, c.key, c.name, c.space])).toEqual([
      ["cat-ana-vet", null, "Vet", { id: "space-ana", name: "Personal" }],
    ]);
    expect(tree.groups[3]!.categories.map((c) => [c.id, c.key, c.name, c.space])).toEqual([
      ["cat-vet", null, "Vet", { id: "space-household", name: "Household" }],
    ]);
  });

  it("names a merged row as the personal space does, even without spending there, else as the space spending most", () => {
    // Household renamed its seeded Food and Housing and their Groceries and Rent; only Household and Trip hold Leisure.
    const household = HOUSEHOLD_TREE.map((n) =>
      n.groupKey === "food"
        ? {
            ...n,
            groupName: "Comida",
            categoryName: n.categoryKey === "groceries" ? "Mercado" : n.categoryName,
          }
        : n.groupKey === "housing"
          ? {
              ...n,
              groupName: "Vivienda",
              categoryName: n.categoryKey === "rent" ? "Arriendo" : n.categoryName,
            }
          : n,
    );
    const trip = { spaceId: "space-trip", id: "grp-trip-leisure", name: "Ocio", key: "leisure" };
    const nodes = [
      ...ANA_TREE,
      ...household,
      node(trip, "cat-trip-fun", "Entretenimiento", { key: "entertainment" }),
    ];
    const spending = [
      inHousehold("cat-groceries", 900_000),
      atHome("cat-ana-groceries", 10_000),
      inHousehold("cat-rent", 100_000),
      inHousehold("cat-entertainment", 30_000),
      spent("space-trip", "cat-trip-fun", 50_000),
    ];
    const tree = spendingTree(spending, nodes, PERSONAL);
    expect(tree.groups.map((g) => [g.key, g.name, g.total])).toEqual([
      ["food", "Food", pesos(910_000)],
      ["housing", "Housing", pesos(100_000)],
      ["leisure", "Ocio", pesos(80_000)],
    ]);
    // Household spends most in its renamed categories, but the personal space holds both keys (Rent without spending).
    expect(tree.groups[0]!.categories.map((c) => [c.key, c.name])).toEqual([["groceries", "Groceries"]]);
    expect(tree.groups[1]!.categories.map((c) => [c.key, c.name])).toEqual([["rent", "Rent"]]);
    expect(tree.groups[2]!.categories.map((c) => [c.key, c.name])).toEqual([
      ["entertainment", "Entretenimiento"],
    ]);
  });

  it("lists subcategories per space under a merged category, and a seeded category under each group its spaces chose", () => {
    const verduras = node(ANA_FOOD, "cat-ana-verduras", "Verduras", { parent: "cat-ana-groceries" });
    const spending = [
      atHome("cat-ana-groceries", 50_000),
      inHousehold("cat-groceries", 10_000),
      inHousehold("cat-vegetables", 30_000),
      atHome("cat-ana-verduras", 20_000),
      atHome("cat-ana-restaurants", 60_000),
      inHousehold("cat-restaurants", 40_000),
    ];
    const tree = spendingTree(spending, [...ANA_TREE, verduras, ...moved], PERSONAL);
    const food = tree.groups.find((g) => g.key === "food")!;
    expect(food.categories.map((c) => [c.key, c.total])).toEqual([
      ["groceries", pesos(110_000)],
      ["restaurants", pesos(60_000)],
    ]);
    // The spending in Groceries itself merges; each space's subcategory keeps its space.
    expect(
      food.categories[0]!.subcategories.map((s) => [s.name, s.space?.name ?? null, s.total, s.share]),
    ).toEqual([
      [null, null, pesos(60_000), 5_455],
      ["Vegetables", "Household", pesos(30_000), 2_727],
      ["Verduras", "Personal", pesos(20_000), 1_818],
    ]);
    // Household moved Restaurants to Leisure, so its 40,000 COP sits there, apart from Ana's in Food.
    expect(tree.groups.find((g) => g.key === "leisure")!.categories.map((c) => [c.key, c.total])).toEqual([
      ["restaurants", pesos(40_000)],
    ]);
  });

  it("names a merged row by the name of the space, then by id, when spaces spend the same and the personal space lacks it (ruling P76)", () => {
    const nodes = [
      node({ spaceId: "space-household", id: "grp-h", name: "Ocio H", key: "leisure" }, "cat-h", "Fun H"),
      node({ spaceId: "space-trip", id: "grp-t", name: "Ocio T", key: "leisure" }, "cat-t", "Fun T"),
    ];
    const spending = [inHousehold("cat-h", 10_000), spent("space-trip", "cat-t", 10_000)];
    const named = (household: string, trip: string) =>
      spendingTree(spending, nodes, {
        kind: "PERSONAL",
        personalSpaceId: "space-ana",
        personalGroups: [],
        spaceNames: new Map([
          ["space-household", household],
          ["space-trip", trip],
        ]),
      }).groups.map((g) => g.name);
    // The space names win over the ids; with the same name the lower id wins.
    expect(named("Zeta", "Alpha")).toEqual(["Ocio T"]);
    expect(named("Same", "Same")).toEqual(["Ocio H"]);
  });

  it("names a merged row from the personal space's group of its key, empty or not, and from no other space's group (#130)", () => {
    const nodes = [
      node({ spaceId: "space-household", id: "grp-h", name: "Ocio H", key: "leisure" }, "cat-h", "Fun H"),
    ];
    const rows = [inHousehold("cat-h", 10_000)];
    const group = (spaceId: string, name: string) => ({
      spaceId,
      groupId: `grp-${spaceId}`,
      groupKey: "leisure",
      groupName: name,
      groupArchived: false,
    });
    const named = (personalGroups: readonly TreeGroup[]) =>
      spendingTree(rows, nodes, { ...PERSONAL, personalGroups }).groups.map((g) => g.name);
    expect(named([group("space-ana", "Ocio mío")])).toEqual(["Ocio mío"]);
    expect(named([group("space-trip", "Ocio T")])).toEqual(["Ocio H"]);
  });

  it("flags a merged row archived only where every space spending in it archived it, subcategories included (ruling P81)", () => {
    const household = { ...LEISURE, archived: true };
    const trip = (archived: boolean) => ({
      spaceId: "space-trip",
      id: "grp-trip-leisure",
      name: "Ocio",
      key: "leisure",
      archived,
    });
    // Ana holds Leisure unarchived but spends nothing in it, so her flag does not count.
    const idle = { spaceId: "space-ana", id: "grp-ana-leisure", name: "Leisure", key: "leisure" };
    const nodes = (tripArchived: boolean) => [
      node(household, "cat-entertainment", "Entertainment", { key: "entertainment", archived: true }),
      node(trip(tripArchived), "cat-trip-fun", "Entertainment", {
        key: "entertainment",
        archived: tripArchived,
      }),
      node(idle, "cat-ana-fun", "Entertainment", { key: "entertainment" }),
      node(ANA_FOOD, "cat-ana-groceries", "Groceries", { key: "groceries" }),
      node(ANA_FOOD, "cat-ana-verduras", "Verduras", { parent: "cat-ana-groceries", archived: true }),
      node(ANA_FOOD, "cat-ana-frutas", "Frutas", { parent: "cat-ana-groceries" }),
    ];
    const spending = [
      inHousehold("cat-entertainment", 10_000),
      spent("space-trip", "cat-trip-fun", 10_000),
      atHome("cat-ana-verduras", 6_000),
      atHome("cat-ana-frutas", 5_000),
    ];
    const archivedIn = (tripArchived: boolean) => {
      const tree = spendingTree(spending, nodes(tripArchived), PERSONAL);
      const leisure = tree.groups.find((g) => g.key === "leisure")!;
      const groceries = tree.groups.find((g) => g.key === "food")!.categories[0]!;
      return {
        group: leisure.archived,
        category: leisure.categories[0]!.archived,
        subcategories: groceries.subcategories.map((s) => [s.name, s.archived]),
      };
    };
    const subcategories = [
      ["Verduras", true],
      ["Frutas", false],
    ];
    expect(archivedIn(true)).toEqual({ group: true, category: true, subcategories });
    expect(archivedIn(false)).toEqual({ group: false, category: false, subcategories });
  });

  it("keeps the id, space and own name of a seeded category moved into a custom group, which never merges (ruling P102)", () => {
    // Household moved its seeded Restaurants into its custom group Pets and renamed it; Ana holds Restaurants in Food.
    const dogFood = node(PETS, "cat-restaurants", "Comida de perro", { key: "restaurants" });
    const nodes = [
      ...ANA_TREE,
      ...HOUSEHOLD_TREE.map((n) => (n.categoryId === "cat-restaurants" ? dogFood : n)),
    ];
    const spending = [
      inHousehold("cat-restaurants", 30_000),
      inHousehold("cat-vet", 10_000),
      atHome("cat-ana-restaurants", 5_000),
    ];
    const tree = spendingTree(spending, nodes, PERSONAL);
    const household = { id: "space-household", name: "Household" };
    const pets = tree.groups.find((g) => g.id === "grp-pets")!;
    expect(pets.space).toEqual(household);
    expect(pets.categories.map((c) => [c.id, c.key, c.name, c.space, c.total])).toEqual([
      ["cat-restaurants", "restaurants", "Comida de perro", household, pesos(30_000)],
      ["cat-vet", null, "Vet", household, pesos(10_000)],
    ]);
    // Ana's own Restaurants in the seeded Food group still merges by its key.
    const food = tree.groups.find((g) => g.key === "food")!;
    expect(food.categories.map((c) => [c.id, c.key, c.name, c.space])).toEqual([
      [null, "restaurants", "Restaurants", null],
    ]);
  });

  it("never flags the spending recorded in a category itself as archived, whatever the category is (ruling P103)", () => {
    const old = { spaceId: "space-household", id: "grp-old", name: "Old" };
    const nodes = [
      node(old, "cat-old", "Old", { archived: true }),
      node(old, "cat-old-sub", "Sub", { parent: "cat-old" }),
    ];
    const spending = [inHousehold("cat-old-sub", 20_000), inHousehold("cat-old", 10_000)];
    const category = spendingTree(spending, nodes, SPACE).groups[0]!.categories[0]!;
    expect(category.archived).toBe(true);
    expect(category.subcategories.map((s) => [s.name, s.archived])).toEqual([
      ["Sub", false],
      [null, false],
    ]);
  });

  it("never lets a seeded category moved under another name the row of its key (ruling P101, spec 5.2)", () => {
    // Ana moved her seeded Restaurants under Groceries and renamed it; it keeps the key `restaurants` but counts there.
    const comidasFuera = node(ANA_FOOD, "cat-ana-restaurants", "Comidas fuera", {
      key: "restaurants",
      parent: "cat-ana-groceries",
    });
    const personal = ANA_TREE.map((n) => (n.categoryId === "cat-ana-restaurants" ? comidasFuera : n));
    const spending = [
      atHome("cat-ana-groceries", 50_000),
      atHome("cat-ana-restaurants", 60_000),
      inHousehold("cat-restaurants", 40_000),
    ];
    const tree = spendingTree(spending, [...personal, ...HOUSEHOLD_TREE], PERSONAL);
    const food = tree.groups.find((g) => g.key === "food")!;
    // Household's top-level Restaurants names the row of its key; the personal one counts under Groceries.
    expect(food.categories.map((c) => [c.key, c.name, c.total])).toEqual([
      ["groceries", "Groceries", pesos(110_000)],
      ["restaurants", "Restaurants", pesos(40_000)],
    ]);
    expect(food.categories[0]!.subcategories.map((s) => [s.name, s.space?.name ?? null, s.total])).toEqual([
      ["Comidas fuera", "Personal", pesos(60_000)],
      [null, null, pesos(50_000)],
    ]);
    expect(food.total).toBe(pesos(150_000));
  });
});
