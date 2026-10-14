import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  checkedMapping,
  newLine,
  reviseLine,
  type BudgetLine,
  type BudgetLineId,
  type LineContext,
  type LineFields,
} from "./budget-line";

const now = new Date("2026-10-14T12:30:00Z");
const fields = (overrides: Partial<LineFields> = {}): LineFields => ({
  name: "Home",
  plannedAmount: 147_000_000n,
  funding: "DIRECT",
  savingsAccountIds: [],
  rolloverMode: "RESET",
  isCatchAll: false,
  ...overrides,
});
// HU-E6-03 Background: capacities Ana 1,600,000 COP and Juan 2,400,000 COP.
const context = (
  siblings: readonly BudgetLine[] = [],
  overrides: Partial<LineContext> = {},
): LineContext => ({
  siblings,
  totalCapacity: 400_000_000n,
  mappedCategories: 0,
  ...overrides,
});
const add = (f: LineFields, c: LineContext = context()) =>
  newLine({ id: "line-new" as BudgetLineId, planId: "plan-november", now, fields: f }, c);
const withoutFree = () => referenceLines().filter((l) => l.name !== "Free");

describe("newLine (HU-E6-03)", () => {
  it("adds Rent with its funding and rollover mode, PROPORTIONAL and without an origin", () => {
    const rent = unwrap(
      add(fields({ name: "  Rent ", plannedAmount: 120_000_000n, funding: "SHARED_FUND" })),
    );
    expect(rent).toEqual({
      id: "line-new",
      planId: "plan-november",
      originLineId: null,
      name: "Rent",
      plannedAmount: 120_000_000n,
      funding: "SHARED_FUND",
      savingsAccountIds: [],
      rolloverMode: "RESET",
      isCatchAll: false,
      allocationRule: "PROPORTIONAL",
      createdAt: now,
    });
  });

  it("fills the capacity exactly with the full reference plan, and refuses anything beyond it, one minor unit included", () => {
    const free = add(fields({ name: "Free", plannedAmount: 73_000_000n }), context(withoutFree()));
    expect(codeOf(free)).toBe("ok");
    for (const plannedAmount of [1n, 10_000_000n]) {
      const travel = add(fields({ name: "Travel", plannedAmount }), context(referenceLines()));
      expect(codeOf(travel)).toBe("PlanExceedsCapacity");
    }
  });

  it("refuses any line while the plan has no capacity", () => {
    expect(codeOf(add(fields(), context([], { totalCapacity: 0n })))).toBe("PlanExceedsCapacity");
  });

  it("keeps line names unique within a plan ignoring case", () => {
    expect(codeOf(add(fields({ name: "home" }), context([aLine("Home", 1n)])))).toBe("BudgetLineNameTaken");
  });

  it("refuses a planned amount that is not positive, 0 COP included", () => {
    for (const plannedAmount of [0n, -100n]) {
      expect(codeOf(add(fields({ name: "Gifts", plannedAmount })))).toBe("InvalidPlannedAmount");
    }
  });

  it.each(["   ", "x".repeat(61)])("refuses the name %j", (name) => {
    expect(codeOf(add(fields({ name })))).toBe("InvalidBudgetLineName");
  });

  it("requires a savings account on a SAVINGS line and refuses accounts on other lines", () => {
    expect(codeOf(add(fields({ name: "Savings", funding: "SAVINGS" })))).toBe("SavingsAccountRequired");
    const direct = add(fields({ savingsAccountIds: ["acc-savings"] }));
    expect(direct).toEqual({
      ok: false,
      error: { code: "InvalidSavingsAccount", details: { reason: "notSavingsLine" } },
    });
    const twice = add(fields({ name: "Savings", funding: "SAVINGS", savingsAccountIds: ["acc-1", "acc-1"] }));
    expect(twice).toEqual({
      ok: false,
      error: { code: "InvalidSavingsAccount", details: { reason: "duplicate" } },
    });
  });

  it("backs one SAVINGS line per plan with each account", () => {
    const again = add(
      fields({
        name: "Emergency",
        funding: "SAVINGS",
        savingsAccountIds: ["acc-savings"],
        plannedAmount: 1n,
      }),
      context(withoutFree()),
    );
    expect(codeOf(again)).toBe("SavingsAccountAlreadyUsed");
  });

  it("never makes a SAVINGS line the catch-all", () => {
    const savings = add(
      fields({ name: "Savings", funding: "SAVINGS", savingsAccountIds: ["a"], isCatchAll: true }),
    );
    expect(codeOf(savings)).toBe("SavingsLineNotMappable");
  });

  it("allows one catch-all line per plan (HU-E6-04)", () => {
    const second = add(
      fields({ name: "Groceries", plannedAmount: 1n, isCatchAll: true }),
      context(referenceLines(), { totalCapacity: 500_000_000n }),
    );
    expect(codeOf(second)).toBe("CatchAllLineAlreadySet");
  });
});

describe("reviseLine (HU-E6-03, HU-E6-04)", () => {
  const home = aLine("Home", 147_000_000n);
  const others = referenceLines().filter((l) => l.name !== "Home");

  it("refuses an increase past the capacity and allows one within it", () => {
    expect(codeOf(reviseLine(home, { plannedAmount: 150_000_000n }, context(others)))).toBe(
      "PlanExceedsCapacity",
    );
    const within = reviseLine(
      home,
      { plannedAmount: 150_000_000n },
      context(others, { totalCapacity: 410_000_000n }),
    );
    expect(unwrap(within).plannedAmount).toBe(150_000_000n);
  });

  it("lets a plan over its capacity lower or rename a line (HU-E6-02)", () => {
    const over = context(others, { totalCapacity: 360_000_000n });
    expect(codeOf(reviseLine(home, { plannedAmount: 140_000_000n }, over))).toBe("ok");
    expect(unwrap(reviseLine(home, { name: "House" }, over)).name).toBe("House");
  });

  it("marks one line as catch-all, and refuses a second", () => {
    const free = aLine("Free", 73_000_000n);
    const marked = unwrap(reviseLine(free, { isCatchAll: true }, context(withoutFree())));
    expect(marked.isCatchAll).toBe(true);
    const second = reviseLine(
      home,
      { isCatchAll: true },
      context([...others.filter((l) => l.name !== "Free"), marked]),
    );
    expect(codeOf(second)).toBe("CatchAllLineAlreadySet");
  });

  it("keeps the allocation rule and drops the savings accounts of a line that stops being SAVINGS", () => {
    const savings = aLine("Savings", 60_000_000n, {
      funding: "SAVINGS",
      savingsAccountIds: ["acc-savings"],
      allocationRule: "FIXED",
    });
    const direct = unwrap(reviseLine(savings, { funding: "DIRECT" }, context([])));
    expect([direct.funding, direct.savingsAccountIds, direct.allocationRule]).toEqual([
      "DIRECT",
      [],
      "FIXED",
    ]);
  });

  it("refuses to turn a line with mapped categories into a SAVINGS line", () => {
    const change = { funding: "SAVINGS" as const, savingsAccountIds: ["acc-2"] };
    expect(codeOf(reviseLine(home, change, context(others, { mappedCategories: 2 })))).toBe(
      "SavingsLineNotMappable",
    );
  });
});

describe("checkedMapping (HU-E6-04)", () => {
  const categories = [
    { id: "cat-groceries", archived: false },
    { id: "cat-utilities", archived: false },
    { id: "cat-old", archived: true },
  ];
  const home = { id: "line-home" as BudgetLineId, funding: "DIRECT" as const };

  it("maps Groceries and Utilities to Home, collapsing duplicates", () => {
    const mapped = checkedMapping(home, ["cat-groceries", "cat-utilities", "cat-groceries"], {
      categories,
      mappings: [],
    });
    expect(unwrap(mapped)).toEqual(["cat-groceries", "cat-utilities"]);
  });

  it("refuses a category mapped to another line of the plan, but keeps the line's own", () => {
    const mappings = [{ lineId: "line-free", categoryId: "cat-groceries" }];
    const free = { id: "line-free" as BudgetLineId, funding: "DIRECT" as const };
    expect(codeOf(checkedMapping(home, ["cat-groceries"], { categories, mappings }))).toBe(
      "CategoryAlreadyMapped",
    );
    expect(unwrap(checkedMapping(free, ["cat-groceries"], { categories, mappings }))).toEqual([
      "cat-groceries",
    ]);
  });

  it("refuses categories that are not live categories of the space, and newly mapped archived ones", () => {
    expect(codeOf(checkedMapping(home, ["cat-personal"], { categories, mappings: [] }))).toBe(
      "CategoryNotInSpace",
    );
    expect(codeOf(checkedMapping(home, ["cat-old"], { categories, mappings: [] }))).toBe("CategoryArchived");
    const kept = checkedMapping(home, ["cat-old"], {
      categories,
      mappings: [{ lineId: "line-home", categoryId: "cat-old" }],
    });
    expect(unwrap(kept)).toEqual(["cat-old"]);
  });

  it("maps nothing to a SAVINGS line, whose spending is transfers (spec 5.4)", () => {
    const savings = { id: "line-savings" as BudgetLineId, funding: "SAVINGS" as const };
    expect(codeOf(checkedMapping(savings, ["cat-groceries"], { categories, mappings: [] }))).toBe(
      "SavingsLineNotMappable",
    );
    expect(unwrap(checkedMapping(savings, [], { categories, mappings: [] }))).toEqual([]);
  });
});
