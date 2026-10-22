import { describe, expect, it } from "vitest";
import { HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { ANA_TREE, HOUSEHOLD_TREE, groupsIn, spent } from "../../../../tests/support/category-trees";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { ANA_PLACES, personalWorld, place } from "../../../../tests/support/personal-world";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import type { CategoryTrees } from "./category-trees";
import { createGetPersonalSpendingByGroup } from "./get-personal-spending-by-group";
import { createGetSpendingByGroup } from "./get-spending-by-group";
import { createGetUnifiedPersonalView } from "./get-unified-personal-view";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";

/** The trees of the spaces asked for, from Ana's and Household's (Task 13); records every question. */
const treesOf = () => {
  const asked: (readonly string[])[] = [];
  const groupsAsked: (readonly string[])[] = [];
  const all = [...ANA_TREE, ...HOUSEHOLD_TREE];
  const trees: CategoryTrees = {
    treesOf: async (spaceIds) => {
      asked.push(spaceIds);
      return all.filter((n) => spaceIds.includes(n.spaceId));
    },
    groupsOf: async (spaceIds) => {
      groupsAsked.push(spaceIds);
      return groupsIn(all.filter((n) => spaceIds.includes(n.spaceId)));
    },
  };
  return { trees, asked, groupsAsked };
};

describe("spending by group of a space (HU-E7-06)", () => {
  const read = (
    w: ReturnType<typeof reportingWorld>,
    trees: CategoryTrees,
    userId = "u-ana",
    period = "2026-11",
    spaceId: string = HOUSEHOLD,
  ) => createGetSpendingByGroup({ ...w.deps, trees })({ spaceId, userId, period });

  it("totals Household's November by group for Ana and VIEWER Sofi alike (@critical)", async () => {
    const w = reportingWorld();
    w.spending.expenses[NOVEMBER] = [
      { categoryId: "cat-rent", amount: pesos(1_200_000) },
      { categoryId: "cat-groceries", amount: pesos(900_000) },
      { categoryId: "cat-utilities", amount: pesos(400_000) },
      { categoryId: "cat-entertainment", amount: pesos(250_000) },
      { categoryId: "cat-restaurants", amount: pesos(60_000) },
    ];
    const t = treesOf();
    const ana = unwrap(await read(w, t.trees));
    expect(ana).toMatchObject({ spaceId: HOUSEHOLD, currency: "COP", total: pesos(2_810_000) });
    expect(ana.period).toEqual({ start: "2026-11-01", end: "2026-11-30", label: "2026-11" });
    expect(ana.groups.map((g) => [g.key, g.total, g.share])).toEqual([
      ["housing", pesos(1_600_000), 5_694],
      ["food", pesos(960_000), 3_416],
      ["leisure", pesos(250_000), 890],
    ]);
    expect(unwrap(await read(w, t.trees, "u-sofi"))).toEqual(ana);
    // Only Household's tree and November's expenses are read, once per reader.
    expect(t.asked).toEqual([[HOUSEHOLD], [HOUSEHOLD]]);
    expect(w.spending.expensesAsked).toEqual([
      [HOUSEHOLD, "2026-11-01", "2026-11-30"],
      [HOUSEHOLD, "2026-11-01", "2026-11-30"],
    ]);
  });

  it("reads October's expenses for 2026-10 and counts Vegetables once, inside Groceries", async () => {
    const w = reportingWorld();
    w.spending.expenses["2026-10-01"] = [
      { categoryId: "cat-groceries", amount: pesos(85_000) },
      { categoryId: "cat-vegetables", amount: pesos(40_000) },
      { categoryId: "cat-restaurants", amount: pesos(60_000) },
    ];
    const october = unwrap(await read(w, treesOf().trees, "u-ana", "2026-10"));
    expect(october.total).toBe(pesos(185_000));
    expect(october.groups[0]!.categories[0]).toMatchObject({ key: "groceries", total: pesos(125_000) });
  });

  it("reads an archived space with nothing spent, and hides the space from non-members and malformed ids", async () => {
    const w = reportingWorld();
    w.spaces.archived.add(HOUSEHOLD);
    const t = treesOf();
    const { trees } = t;
    expect(unwrap(await read(w, trees, "u-juan"))).toMatchObject({ total: 0n, groups: [] });
    expect(codeOf(await read(w, trees, "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await read(w, trees, "u-ana", "2026-11", "not-a-uuid"))).toBe("SpaceNotFound");
    expect(codeOf(await read(w, trees, "u-ana", "2026-11 H1"))).toBe("InvalidPeriodLabel");
    // A refused reader or label triggers no read: only Juan's answer asked for the tree and the expenses.
    expect(t.asked).toEqual([[HOUSEHOLD]]);
    expect(w.spending.expensesAsked).toHaveLength(1);
  });
});

describe("personal spending by group (HU-E7-06)", () => {
  const read = (
    w: ReturnType<typeof personalWorld>,
    trees: CategoryTrees,
    period = "2026-11",
    userId = "u-ana",
  ) => createGetPersonalSpendingByGroup({ ...w.deps, trees })({ userId, period });
  /** HU-E7-04 Background as the ledger sums Ana's rows (Task 8b). */
  const background = () => [
    spent("space-ana", "cat-ana-groceries", 85_000),
    spent("space-ana", "cat-ana-restaurants", 60_000),
    spent("space-household", "cat-groceries", 950_000),
    spent("space-household", "cat-rent", 480_000),
  ];

  it("groups Ana's consumption across her spaces, asking only about her own rows in her personal period (@critical)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      ...background(),
      spent("space-ana", "cat-ana-vet", 40_000),
      spent("space-household", "cat-vet", 25_000),
    ];
    const t = treesOf();
    const breakdown = unwrap(await read(w, t.trees));
    expect(breakdown).toMatchObject({
      currency: "COP",
      total: pesos(1_640_000),
      period: { label: "2026-11", start: "2026-11-01", end: "2026-11-30" },
    });
    expect(breakdown.groups.map((g) => [g.key, g.space?.name ?? null, g.total, g.share])).toEqual([
      ["food", null, pesos(1_095_000), 6_677],
      ["housing", null, pesos(480_000), 2_927],
      [null, "Personal", pesos(40_000), 244],
      [null, "Household", pesos(25_000), 152],
    ]);
    expect(w.sums.asked).toEqual([
      { memberIds: ["member-ana-personal", "member-ana"], from: "2026-11-01", to: "2026-11-30" },
    ]);
    // Her personal space's tree is always read, to name the merged rows (ruling P76).
    expect(t.asked).toEqual([["space-ana", "space-household"]]);
  });

  it("names a merged row from her personal space's tree even when nothing was spent in that space (ruling P76)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [spent("space-household", "cat-groceries", 950_000)];
    const t = treesOf();
    const renamed = (n: { spaceId: string; groupKey: string | null }) =>
      n.spaceId === "space-ana" && n.groupKey === "food";
    const trees: CategoryTrees = {
      treesOf: async (spaceIds) =>
        (await t.trees.treesOf(spaceIds)).map((n) => (renamed(n) ? { ...n, groupName: "Comida" } : n)),
      groupsOf: async (spaceIds) =>
        (await t.trees.groupsOf(spaceIds)).map((g) => (renamed(g) ? { ...g, groupName: "Comida" } : g)),
    };
    const breakdown = unwrap(await read(w, trees));
    expect(breakdown.groups.map((g) => [g.key, g.name, g.total])).toEqual([
      ["food", "Comida", pesos(950_000)],
    ]);
    expect(t.asked).toEqual([["space-ana", "space-household"]]);
  });

  it("names a merged row from a personal group that holds no live category, which treesOf cannot list (#130)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      spent("space-household", "cat-groceries", 950_000),
      spent("space-household", "cat-rent", 480_000),
    ];
    const t = treesOf();
    const trees: CategoryTrees = {
      // Ana's seeded Food group lost every live category (all deleted) and is renamed "Comida"; Housing is intact.
      treesOf: async (spaceIds) =>
        (await t.trees.treesOf(spaceIds)).filter(
          (n) => !(n.spaceId === "space-ana" && n.groupKey === "food"),
        ),
      groupsOf: async (spaceIds) =>
        (await t.trees.groupsOf(spaceIds)).map((g) =>
          g.spaceId === "space-ana" && g.groupKey === "food" ? { ...g, groupName: "Comida" } : g,
        ),
    };
    const breakdown = unwrap(await read(w, trees));
    expect(breakdown.groups.map((g) => [g.key, g.name, g.total])).toEqual([
      ["food", "Comida", pesos(950_000)],
      ["housing", "Housing", pesos(480_000)],
    ]);
  });

  it("keeps naming a merged row from a group with live categories in her personal space, asking only for her own groups (#130)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [spent("space-household", "cat-groceries", 950_000)];
    const t = treesOf();
    const breakdown = unwrap(await read(w, t.trees));
    expect(breakdown.groups.map((g) => [g.key, g.name])).toEqual([["food", "Food"]]);
    expect(t.groupsAsked).toEqual([["space-ana"]]);
  });

  it("totals exactly the consumption of Ana's unified view", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = background();
    const breakdown = unwrap(await read(w, treesOf().trees));
    const view = unwrap(await createGetUnifiedPersonalView(w.deps)({ userId: "u-ana", period: "2026-11" }));
    expect(breakdown.total).toBe(pesos(1_575_000));
    expect(breakdown.total).toBe(view.consumption.total);
  });

  it("leaves spaces in another currency out and refuses a label her personal policy does not name", async () => {
    const trip = place("space-trip", "member-ana-trip", "Trip", { currency: "USD" });
    const w = personalWorld([...ANA_PLACES, trip]);
    const { trees } = treesOf();
    expect(unwrap(await read(w, trees)).currency).toBe("COP");
    expect(w.sums.asked[0]?.memberIds).toEqual(["member-ana-personal", "member-ana"]);
    expect(codeOf(await read(w, trees, "2026-11 H1"))).toBe("InvalidPeriodLabel");
    expect(codeOf(await read(w, trees, "2026-11", "u-nobody"))).toBe("SpaceNotFound");
    // Neither refusal asked the ledger for anything: only the first read did.
    expect(w.sums.asked).toHaveLength(1);
  });
});
