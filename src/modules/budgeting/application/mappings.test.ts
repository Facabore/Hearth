import { describe, expect, it } from "vitest";
import { referenceLines } from "../../../../tests/support/budget-fixtures";
import {
  budgetingWorld,
  HOUSEHOLD,
  householdCategories,
  NOW,
  savingsAccounts,
} from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createMapCategoriesToLine } from "./map-categories-to-line";
import type { BudgetPlanView } from "./plan-view";
import { createRemoveBudgetLine } from "./remove-budget-line";
import { createUpdateBudgetLine } from "./update-budget-line";

/** HU-E6-04 Background: the reference plan for 2026-11 in Household, without a catch-all line. */
const world = async () => {
  const w = budgetingWorld();
  const deps = {
    ...w.deps,
    mappings: w.plans,
    categories: householdCategories,
    lines: w.plans,
    savingsAccounts,
  };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  w.plans.seed(plan.id, {
    capacities: [
      { memberId: "member-ana", amount: 160_000_000n },
      { memberId: "member-juan", amount: 240_000_000n },
    ],
    lines: referenceLines().map((l) => ({ ...l, isCatchAll: false })),
  });
  const map = createMapCategoriesToLine(deps);
  const mapTo = (line: string, categoryIds: string[], userId = "u-ana") =>
    map({
      spaceId: HOUSEHOLD,
      userId,
      planId: plan.id,
      lineId: `line-${line}`,
      expectedVersion: null,
      categoryIds,
    });
  const lineIn = (view: BudgetPlanView, name: string) =>
    view.figures.lines.find((l) => l.line.name === name)!;
  return { ...w, deps, plan, mapTo, lineIn };
};

describe("MapCategoriesToLine (HU-E6-04)", () => {
  it("maps Groceries and Utilities to Home, so a Groceries expense counts as spent in Home", async () => {
    const { mapTo, spending, lineIn } = await world();
    spending.byCategory = [{ categoryId: "cat-groceries", amount: 8_500_000n }];
    const view = unwrap(await mapTo("home", ["cat-groceries", "cat-utilities"]));
    const home = lineIn(view, "Home");
    expect([home.categoryIds, home.spent]).toEqual([["cat-groceries", "cat-utilities"], 8_500_000n]);
    expect(view.figures.unbudgeted).toEqual({ spent: 0n, available: 0n });
  });

  it("maps a category to at most one line per plan", async () => {
    const { mapTo } = await world();
    unwrap(await mapTo("home", ["cat-groceries"]));
    expect(codeOf(await mapTo("free", ["cat-groceries"]))).toBe("CategoryAlreadyMapped");
  });

  it("moves a category once its line lets it go, keeping the ended mapping (D8, Review Focus 6)", async () => {
    const { mapTo, plans, lineIn } = await world();
    unwrap(await mapTo("home", ["cat-groceries", "cat-utilities"]));
    unwrap(await mapTo("home", ["cat-utilities"]));
    const view = unwrap(await mapTo("free", ["cat-groceries"]));
    expect(lineIn(view, "Free").categoryIds).toEqual(["cat-groceries"]);
    const history = plans.mappings.filter((r) => r.mapping.categoryId === "cat-groceries");
    expect(history.map((r) => [r.mapping.lineId, r.unmappedAt])).toEqual([
      ["line-home", NOW],
      ["line-free", null],
    ]);
  });

  it("frees the categories of a removed line (Review Focus 6)", async () => {
    const { mapTo, deps, plan } = await world();
    unwrap(await mapTo("home", ["cat-groceries"]));
    const remove = createRemoveBudgetLine(deps);
    unwrap(
      await remove({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        planId: plan.id,
        lineId: "line-home",
        expectedVersion: null,
      }),
    );
    expect(codeOf(await mapTo("free", ["cat-groceries"]))).toBe("ok");
  });

  it("maps only live categories of the plan's space, and never newly an archived one (Review Focus 5)", async () => {
    const { mapTo } = await world();
    expect(codeOf(await mapTo("free", ["cat-personal"]))).toBe("CategoryNotInSpace");
    expect(codeOf(await mapTo("free", ["not-a-category"]))).toBe("CategoryNotInSpace");
    expect(codeOf(await mapTo("free", ["cat-old"]))).toBe("CategoryArchived");
  });

  it("maps nothing to a SAVINGS line, whose spending is its transfers (spec 5.4)", async () => {
    const { mapTo } = await world();
    expect(codeOf(await mapTo("savings", ["cat-groceries"]))).toBe("SavingsLineNotMappable");
  });

  it("puts unmapped spending in Unbudgeted without a catch-all line, and in the catch-all line with one", async () => {
    const { mapTo, spending, deps, plan, lineIn } = await world();
    spending.byCategory = [{ categoryId: "cat-restaurants", amount: 6_000_000n }];
    const without = unwrap(await mapTo("home", ["cat-groceries"]));
    expect(without.figures.unbudgeted).toEqual({ spent: 6_000_000n, available: -6_000_000n });
    const update = createUpdateBudgetLine(deps);
    const input = {
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: plan.id,
      lineId: "line-free",
      expectedVersion: null,
    };
    const withFree = unwrap(await update({ ...input, changes: { isCatchAll: true } }));
    expect([withFree.figures.unbudgeted, lineIn(withFree, "Free").spent]).toEqual([null, 6_000_000n]);
  });

  it("lets only owners and admins map categories, and answers BudgetLineNotFound for unknown lines", async () => {
    const { mapTo } = await world();
    expect(codeOf(await mapTo("home", ["cat-groceries"], "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await mapTo("travel", ["cat-groceries"]))).toBe("BudgetLineNotFound");
  });

  it("answers the same CategoryNotInSpace for an unknown, a malformed and another space's category (P6)", async () => {
    const { mapTo, plans } = await world();
    const refusals = [
      await mapTo("free", ["cat-groceries", "cat-personal"]),
      await mapTo("free", ["cat-groceries", "not-a-uuid"]),
      await mapTo("free", ["cat-groceries", "00000000-0000-4000-8000-000000000000"]),
      await mapTo("free", ["cat-groceries", ""]),
    ];
    expect(refusals.map(codeOf)).toEqual(Array(4).fill("CategoryNotInSpace"));
    expect(plans.mappings).toEqual([]);
  });

  it("keeps a mapping the line already has when its category was archived since, and takes none newly", async () => {
    const { mapTo, plans, plan, lineIn } = await world();
    plans.seed(plan.id, { mappings: [{ lineId: "line-home", categoryId: "cat-old" }] });
    const view = unwrap(await mapTo("home", ["cat-old", "cat-groceries"]));
    expect(lineIn(view, "Home").categoryIds).toEqual(["cat-groceries", "cat-old"]);
    expect(codeOf(await mapTo("free", ["cat-old"]))).toBe("CategoryArchived");
    expect(codeOf(await mapTo("free", ["cat-groceries"]))).toBe("CategoryAlreadyMapped");
    unwrap(await mapTo("home", ["cat-groceries"]));
    expect(codeOf(await mapTo("home", ["cat-old"]))).toBe("CategoryArchived");
  });

  it("leaves the rows of the categories a line keeps untouched when the same set is sent again", async () => {
    const { mapTo, plans } = await world();
    unwrap(await mapTo("home", ["cat-groceries", "cat-utilities"]));
    const before = structuredClone(plans.mappings);
    const again = unwrap(await mapTo("home", ["cat-utilities", "cat-groceries", "cat-groceries"]));
    expect(plans.mappings).toEqual(before);
    expect(plans.mappings.map((r) => [r.mappedAt, r.unmappedAt])).toEqual([
      [NOW, null],
      [NOW, null],
    ]);
    expect(again.figures.lines.find((l) => l.line.name === "Home")?.categoryIds).toEqual([
      "cat-groceries",
      "cat-utilities",
    ]);
  });

  it("empties a line's categories without deleting any row, and refuses an unknown plan", async () => {
    const { mapTo, plans, deps } = await world();
    unwrap(await mapTo("home", ["cat-groceries", "cat-utilities"]));
    const emptied = unwrap(await mapTo("home", []));
    expect(emptied.figures.lines.find((l) => l.line.name === "Home")?.categoryIds).toEqual([]);
    expect(plans.mappings.map((r) => [r.mapping.categoryId, r.unmappedAt])).toEqual([
      ["cat-groceries", NOW],
      ["cat-utilities", NOW],
    ]);
    const map = createMapCategoriesToLine(deps);
    const input = { spaceId: HOUSEHOLD, userId: "u-ana", lineId: "line-home", expectedVersion: null };
    expect(codeOf(await map({ ...input, planId: "not-a-plan", categoryIds: ["cat-groceries"] }))).toBe(
      "BudgetPlanNotFound",
    );
  });

  it("refuses a stale If-Match and writes nothing", async () => {
    const { deps, plan, plans } = await world();
    const map = createMapCategoriesToLine(deps);
    const stale = await map({
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: plan.id,
      lineId: "line-home",
      expectedVersion: 7,
      categoryIds: ["cat-groceries"],
    });
    expect(codeOf(stale)).toBe("PreconditionFailed");
    expect(plans.mappings).toEqual([]);
  });
});
