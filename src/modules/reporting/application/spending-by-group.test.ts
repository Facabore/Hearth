import { describe, expect, it } from "vitest";
import { HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { ANA_TREE, HOUSEHOLD_TREE, groupsIn, spent } from "../../../../tests/support/category-trees";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { ANA_PLACES, personalWorld, place } from "../../../../tests/support/personal-world";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import type { AccountMovement } from "../domain/account-flows";
import type { AccountMovements } from "./account-movements";
import type { CategoryTrees } from "./category-trees";
import { createGetPersonalSpendingByGroup } from "./get-personal-spending-by-group";
import { createGetSpendingByGroup } from "./get-spending-by-group";
import { createGetUnifiedPersonalView } from "./get-unified-personal-view";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";

/** The trees of the spaces asked for, from Ana's and Household's; records every question. */
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

/** Ruling P327: the accounts' spaces and their movements; records every question about movements. */
const movementsOf = (spaces: Record<string, string> = {}, movements: readonly AccountMovement[] = []) => {
  const asked: { accountId: string; spaceIds: readonly string[]; from: string; to: string }[] = [];
  const port: AccountMovements = {
    spaceOf: async (accountId) => spaces[accountId] ?? null,
    movementsOf: async (accountId, spaceIds, from, to) => {
      asked.push({ accountId, spaceIds, from, to });
      return movements.filter((m) => spaceIds.includes(m.spaceId));
    },
  };
  return { port, asked };
};

/** One movement of an account, as the ledger's list gives it filtered by the account (P277). */
const movement = (spaceId: string, overrides: Partial<AccountMovement>): AccountMovement => ({
  spaceId,
  type: "EXPENSE",
  categoryId: null,
  amount: 0n,
  paid: 0n,
  sourceAccountId: null,
  destinationAccountId: null,
  betweenOwnAccounts: false,
  ...overrides,
});

const expense = (spaceId: string, categoryId: string, amount: number, paid = amount) =>
  movement(spaceId, { categoryId, amount: pesos(amount), paid: pesos(paid) });

describe("spending by group of a space (HU-E7-06)", () => {
  const read = (
    w: ReturnType<typeof reportingWorld>,
    trees: CategoryTrees,
    userId = "u-ana",
    period = "2026-11",
    spaceId: string = HOUSEHOLD,
    accounts = movementsOf(),
    accountId?: string,
  ) =>
    createGetSpendingByGroup({ ...w.deps, trees, accountMovements: accounts.port })({
      spaceId,
      userId,
      period,
      accountId,
    });

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

  it("answers without accountId exactly as before: no account figures and no counts (ruling P327)", async () => {
    const w = reportingWorld();
    w.spending.expenses[NOVEMBER] = [{ categoryId: "cat-rent", amount: pesos(1_200_000) }];
    const accounts = movementsOf({ "acc-fund": HOUSEHOLD });
    const breakdown = unwrap(await read(w, treesOf().trees, "u-ana", "2026-11", HOUSEHOLD, accounts));
    expect(breakdown).not.toHaveProperty("account");
    expect(breakdown.groups[0]).not.toHaveProperty("movements");
    expect(breakdown.groups[0]!.categories[0]).not.toHaveProperty("movements");
    expect(accounts.asked).toEqual([]);
  });

  it("with the fund's id counts only what the fund paid, by group with its expenses, and what came in and went out (ruling P327)", async () => {
    const w = reportingWorld();
    // Household's own expenses are not what the fund paid: they are never read for the fund's breakdown.
    w.spending.expenses[NOVEMBER] = [{ categoryId: "cat-rent", amount: pesos(1_200_000) }];
    const accounts = movementsOf({ "acc-fund": HOUSEHOLD }, [
      expense(HOUSEHOLD, "cat-groceries", 300_000),
      expense(HOUSEHOLD, "cat-groceries", 60_000),
      // Paid half from the fund, half by a member: only the fund's half counts.
      expense(HOUSEHOLD, "cat-utilities", 220_000, 110_000),
      movement(HOUSEHOLD, {
        type: "TRANSFER",
        amount: pesos(2_320_000),
        destinationAccountId: "acc-fund",
      }),
      movement(HOUSEHOLD, { type: "TRANSFER", amount: pesos(160_000), destinationAccountId: "acc-fund" }),
    ]);
    const breakdown = unwrap(
      await read(w, treesOf().trees, "u-sofi", "2026-11", HOUSEHOLD, accounts, "acc-fund"),
    );
    expect(breakdown.total).toBe(pesos(470_000));
    expect(breakdown.groups.map((g) => [g.key, g.total, g.share, g.movements])).toEqual([
      ["food", pesos(360_000), 7_660, 2],
      ["housing", pesos(110_000), 2_340, 1],
    ]);
    expect(breakdown.groups[0]!.categories.map((c) => [c.key, c.movements])).toEqual([["groceries", 2]]);
    expect(breakdown.account).toEqual({
      id: "acc-fund",
      in: pesos(2_480_000),
      out: pesos(470_000),
      movedToOwnAccounts: 0n,
    });
    expect(accounts.asked).toEqual([
      { accountId: "acc-fund", spaceIds: [HOUSEHOLD], from: "2026-11-01", to: "2026-11-30" },
    ]);
    expect(w.spending.expensesAsked).toEqual([]);
  });

  it("answers AccountNotFound for an account of another space, and reads none of its movements", async () => {
    const w = reportingWorld();
    const accounts = movementsOf({ "acc-bank": "space-ana" });
    const t = treesOf();
    for (const accountId of ["acc-bank", "acc-unknown"])
      expect(codeOf(await read(w, t.trees, "u-ana", "2026-11", HOUSEHOLD, accounts, accountId))).toBe(
        "AccountNotFound",
      );
    // The space is checked first: a stranger learns nothing about the account.
    expect(codeOf(await read(w, t.trees, "u-marta", "2026-11", HOUSEHOLD, accounts, "acc-bank"))).toBe(
      "SpaceNotFound",
    );
    expect(accounts.asked).toEqual([]);
    expect(t.asked).toEqual([]);
  });
});

describe("personal spending by group (HU-E7-06)", () => {
  const read = (
    w: ReturnType<typeof personalWorld>,
    trees: CategoryTrees,
    period = "2026-11",
    userId = "u-ana",
    accounts = movementsOf(),
    accountId?: string,
  ) =>
    createGetPersonalSpendingByGroup({ ...w.deps, trees, accountMovements: accounts.port })({
      userId,
      period,
      accountId,
    });
  /** HU-E7-04 Background as the ledger sums Ana's rows. */
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

  it("names the spaces each of her groups came from, by their names as she sees them (#240, board E9-11 02)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = background();
    const breakdown = unwrap(await read(w, treesOf().trees));
    expect(breakdown.groups.map((g) => [g.key, g.spaces?.map((s) => s.name)])).toEqual([
      ["food", ["Personal", "Household"]],
      ["housing", ["Household"]],
    ]);
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

  it("answers without accountId exactly as before: no account figures and no counts (ruling P327)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = background();
    const accounts = movementsOf({ "acc-bank": "space-ana" });
    const breakdown = unwrap(await read(w, treesOf().trees, "2026-11", "u-ana", accounts));
    expect(breakdown).not.toHaveProperty("account");
    expect(breakdown.groups[0]).not.toHaveProperty("movements");
    expect(accounts.asked).toEqual([]);
  });

  it("with one of her accounts counts what it paid in every space of hers, merged by key, and her transfers to her own accounts are no spending (ruling P327, D21)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = background();
    const accounts = movementsOf({ "acc-bank": "space-ana" }, [
      // A Household delivery paid whole from her bank account: the account paid 64,000; her share is not asked.
      expense("space-household", "cat-restaurants", 64_000),
      expense("space-household", "cat-rent", 2_000_000),
      expense("space-ana", "cat-ana-restaurants", 30_000),
      movement("space-ana", {
        type: "INCOME",
        amount: pesos(3_200_000),
        destinationAccountId: "acc-bank",
      }),
      movement("space-ana", {
        type: "TRANSFER",
        amount: pesos(500_000),
        sourceAccountId: "acc-bank",
        destinationAccountId: "acc-savings",
        betweenOwnAccounts: true,
      }),
      // Her contribution to the Household fund leaves the account, but is no transfer between her own accounts.
      movement("space-household", {
        type: "TRANSFER",
        amount: pesos(160_000),
        sourceAccountId: "acc-bank",
        destinationAccountId: "acc-fund",
      }),
    ]);
    const breakdown = unwrap(await read(w, treesOf().trees, "2026-11", "u-ana", accounts, "acc-bank"));
    expect(breakdown.total).toBe(pesos(2_094_000));
    expect(breakdown.groups.map((g) => [g.key, g.total, g.movements, g.spaces?.map((s) => s.name)])).toEqual([
      ["housing", pesos(2_000_000), 1, ["Household"]],
      ["food", pesos(94_000), 2, ["Personal", "Household"]],
    ]);
    expect(breakdown.groups[1]!.categories.map((c) => [c.key, c.total, c.movements])).toEqual([
      ["restaurants", pesos(94_000), 2],
    ]);
    expect(breakdown.account).toEqual({
      id: "acc-bank",
      in: pesos(3_200_000),
      out: pesos(2_754_000),
      movedToOwnAccounts: pesos(500_000),
    });
    expect(accounts.asked).toEqual([
      {
        accountId: "acc-bank",
        spaceIds: ["space-ana", "space-household"],
        from: "2026-11-01",
        to: "2026-11-30",
      },
    ]);
    // Her shares are not what the account paid: they are never read for its breakdown.
    expect(w.sums.asked).toEqual([]);
  });

  it("answers AccountNotFound for an account outside her personal space, and reads none of its movements", async () => {
    const w = personalWorld();
    const accounts = movementsOf({ "acc-fund": "space-household" });
    for (const accountId of ["acc-fund", "acc-unknown"])
      expect(codeOf(await read(w, treesOf().trees, "2026-11", "u-ana", accounts, accountId))).toBe(
        "AccountNotFound",
      );
    expect(accounts.asked).toEqual([]);
    expect(w.sums.asked).toEqual([]);
  });
});
