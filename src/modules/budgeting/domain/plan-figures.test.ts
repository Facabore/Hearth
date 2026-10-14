import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import {
  lineForCategory,
  planFigures,
  type PeriodSpending,
  type PlanFigures,
  type PlanParts,
} from "./plan-figures";

const ANA = "member-ana";
const JUAN = "member-juan";
const PEDRO = "member-pedro";

/** Spec section 4 with the E7 mappings: Rent → Rent; Groceries, Utilities → Home; Free 42 % / 58 %, catch-all. */
const reference = (overrides: Partial<PlanParts> = {}): PlanParts => ({
  capacities: [
    { memberId: ANA, amount: 160_000_000n },
    { memberId: JUAN, amount: 240_000_000n },
  ],
  lines: referenceLines().map((l) => (l.name === "Free" ? { ...l, allocationRule: "PERCENT" as const } : l)),
  mappings: [
    { lineId: "line-rent", categoryId: "cat-rent" },
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
  ],
  allocations: [
    { lineId: "line-free", memberId: ANA, value: 4200n },
    { lineId: "line-free", memberId: JUAN, value: 5800n },
  ],
  ...overrides,
});
// HU-E7-01 Background in 2026-11, plus a 200,000 COP transfer into the savings account.
const NOVEMBER: PeriodSpending = {
  byCategory: [
    { categoryId: "cat-rent", amount: 120_000_000n },
    { categoryId: "cat-groceries", amount: 90_000_000n },
    { categoryId: "cat-utilities", amount: 40_000_000n },
    { categoryId: "cat-entertainment", amount: 25_000_000n },
  ],
  byAccount: [{ accountId: "acc-savings", amount: 20_000_000n }],
};
const NOTHING: PeriodSpending = { byCategory: [], byAccount: [] };
const figures = (parts: PlanParts, memberIds = [ANA, JUAN], spending = NOVEMBER) =>
  planFigures({ currency: "COP", memberIds, parts, spending });
const line = (f: PlanFigures, name: string) => f.lines.find((l) => l.line.name === name)!;
const assigned = (f: PlanFigures, name: string) =>
  line(f, name).allocation.members.map((m) => [m.memberId, m.assigned]);

describe("the reference plan (spec section 4, golden)", () => {
  it("has 4,000,000 COP of capacity at 40 % / 60 %, all of it planned", () => {
    const f = figures(reference());
    expect(f.capacities).toEqual([
      { memberId: ANA, amount: 160_000_000n, shareBasisPoints: 4000 },
      { memberId: JUAN, amount: 240_000_000n, shareBasisPoints: 6000 },
    ]);
    expect([f.totalCapacity, f.planned, f.unallocated]).toEqual([400_000_000n, 400_000_000n, 0n]);
    expect(f.lines.map((l) => [l.line.name, l.capacityShareBasisPoints])).toEqual([
      ["Rent", 3000],
      ["Home", 3675],
      ["Savings", 1500],
      ["Free", 1825],
    ]);
  });

  it("assigns every line as the reference table does", () => {
    const f = figures(reference());
    expect(assigned(f, "Rent")).toEqual([
      [ANA, 48_000_000n],
      [JUAN, 72_000_000n],
    ]);
    expect(assigned(f, "Home")).toEqual([
      [ANA, 58_800_000n],
      [JUAN, 88_200_000n],
    ]);
    expect(assigned(f, "Savings")).toEqual([
      [ANA, 24_000_000n],
      [JUAN, 36_000_000n],
    ]);
    expect(assigned(f, "Free")).toEqual([
      [ANA, 30_660_000n],
      [JUAN, 42_340_000n],
    ]);
    expect(line(f, "Free").allocation.members.map((m) => m.value)).toEqual([4200n, 5800n]);
    expect(line(f, "Home").allocation).toMatchObject({ rule: "PROPORTIONAL", invalid: false });
  });

  it("spends mapped categories on their line, unmapped ones on the catch-all and transfers on Savings (HU-E6-04)", () => {
    const f = figures(reference());
    expect(f.lines.map((l) => [l.line.name, l.spent, l.available])).toEqual([
      ["Rent", 120_000_000n, 0n],
      ["Home", 130_000_000n, 17_000_000n],
      ["Savings", 20_000_000n, 40_000_000n],
      ["Free", 25_000_000n, 48_000_000n],
    ]);
    expect(line(f, "Home").categoryIds).toEqual(["cat-groceries", "cat-utilities"]);
    expect(f.unbudgeted).toBeNull();
  });
});

describe("plan figures beyond the reference plan", () => {
  it("puts unmapped spending in Unbudgeted when the plan has no catch-all line (HU-E6-04)", () => {
    const parts = reference({ lines: reference().lines.map((l) => ({ ...l, isCatchAll: false })) });
    const spending = { byCategory: [{ categoryId: "cat-restaurants", amount: 6_000_000n }], byAccount: [] };
    const f = figures(parts, [ANA, JUAN], spending);
    expect(f.unbudgeted).toEqual({ spent: 6_000_000n, available: -6_000_000n });
    expect(line(f, "Free").spent).toBe(0n);
    expect(lineForCategory("cat-restaurants", parts)).toBeNull();
    expect(lineForCategory("cat-restaurants", reference())).toBe("line-free");
    expect(lineForCategory("cat-groceries", reference())).toBe("line-home");
  });

  it("ignores a mapping whose line is not a current line, so that spending is not lost (HU-E6-04)", () => {
    const stale = { lineId: "line-removed", categoryId: "cat-restaurants" };
    const parts = reference({ mappings: [...reference().mappings, stale] });
    const spending = { byCategory: [{ categoryId: "cat-restaurants", amount: 6_000_000n }], byAccount: [] };
    expect(lineForCategory("cat-restaurants", parts)).toBe("line-free");
    const withCatchAll = figures(parts, [ANA, JUAN], spending);
    expect([line(withCatchAll, "Free").spent, withCatchAll.unbudgeted]).toEqual([6_000_000n, null]);

    const noCatchAll = { ...parts, lines: parts.lines.map((l) => ({ ...l, isCatchAll: false })) };
    expect(lineForCategory("cat-restaurants", noCatchAll)).toBeNull();
    expect(figures(noCatchAll, [ANA, JUAN], spending).unbudgeted).toEqual({
      spent: 6_000_000n,
      available: -6_000_000n,
    });
  });

  it("spends on a SAVINGS line only the transfers into its own accounts (spec 5.4)", () => {
    const spending = {
      byCategory: [],
      byAccount: [
        { accountId: "acc-other", amount: 7_000_000n },
        { accountId: "acc-savings", amount: 20_000_000n },
      ],
    };
    const f = figures(reference(), [ANA, JUAN], spending);
    expect(f.lines.map((l) => [l.line.name, l.spent])).toEqual([
      ["Rent", 0n],
      ["Home", 0n],
      ["Savings", 20_000_000n],
      ["Free", 0n],
    ]);
    expect(line(f, "Savings").available).toBe(40_000_000n);
    expect(f.unbudgeted).toBeNull();
  });

  it("reports planned, spent and available but nobody's assignment on a NONE line (HU-E6-05)", () => {
    const parts = reference({
      lines: reference().lines.map((l) =>
        l.name === "Free" ? { ...l, allocationRule: "NONE" as const } : l,
      ),
    });
    const free = line(figures(parts), "Free");
    expect(free.allocation).toEqual({ rule: "NONE", members: [], invalid: false });
    expect([free.line.plannedAmount, free.spent, free.available]).toEqual([
      73_000_000n,
      25_000_000n,
      48_000_000n,
    ]);
  });

  it("flags PROPORTIONAL lines and gives no shares while every capacity is 0 (HU-E6-05)", () => {
    const f = figures(reference({ capacities: [] }), [ANA, JUAN], NOTHING);
    expect(f.capacities.map((c) => c.shareBasisPoints)).toEqual([null, null]);
    expect(line(f, "Home").allocation.invalid).toBe(true);
    expect(assigned(f, "Home")).toEqual([
      [ANA, null],
      [JUAN, null],
    ]);
    expect(line(f, "Home").capacityShareBasisPoints).toBeNull();
    expect(line(f, "Free").allocation.invalid).toBe(false);
    expect(f.unallocated).toBe(-400_000_000n);
  });

  it("drops a member who left from every figure and flags the PERCENT line that named them (Review Focus 2)", () => {
    const f = figures(reference(), [ANA], NOTHING);
    expect([f.totalCapacity, f.unallocated]).toEqual([160_000_000n, -240_000_000n]);
    expect(assigned(f, "Home")).toEqual([[ANA, 147_000_000n]]);
    expect(line(f, "Free").allocation).toEqual({
      rule: "PERCENT",
      members: [{ memberId: ANA, value: 4200n, assigned: null }],
      invalid: true,
    });
  });

  it("reports capacity reduced below the lines as negative unallocated capacity (HU-E6-02)", () => {
    const reduced = reference({
      capacities: [
        { memberId: ANA, amount: 160_000_000n },
        { memberId: JUAN, amount: 200_000_000n },
      ],
    });
    const f = figures(reduced, [ANA, JUAN], NOTHING);
    expect([f.totalCapacity, f.unallocated]).toEqual([360_000_000n, -40_000_000n]);
    // PROPORTIONAL lines follow the 4:5 capacities, in rounding units of 100 minor units; the odd unit goes to the
    // largest remainder (spec 5.3).
    expect(assigned(f, "Rent")).toEqual([
      [ANA, 53_333_300n],
      [JUAN, 66_666_700n],
    ]);
    expect(assigned(f, "Home")).toEqual([
      [ANA, 65_333_300n],
      [JUAN, 81_666_700n],
    ]);
    expect(assigned(f, "Savings")).toEqual([
      [ANA, 26_666_700n],
      [JUAN, 33_333_300n],
    ]);
    // The PERCENT line does not follow capacities.
    expect(assigned(f, "Free")).toEqual([
      [ANA, 30_660_000n],
      [JUAN, 42_340_000n],
    ]);
  });

  it("reports capacity raised above the lines as positive unallocated capacity (HU-E6-02)", () => {
    const raised = reference({
      capacities: [
        { memberId: ANA, amount: 160_000_000n },
        { memberId: JUAN, amount: 300_000_000n },
      ],
    });
    const f = figures(raised, [ANA, JUAN], NOTHING);
    expect([f.totalCapacity, f.planned, f.unallocated]).toEqual([460_000_000n, 400_000_000n, 60_000_000n]);
  });

  it("counts a guest's capacity like anyone's (D15)", () => {
    const parts = reference({
      capacities: [...reference().capacities, { memberId: PEDRO, amount: 100_000_000n }],
      lines: [aLine("Home", 147_000_000n)],
      allocations: [],
    });
    expect(assigned(figures(parts, [ANA, JUAN, PEDRO], NOTHING), "Home")).toEqual([
      [ANA, 47_040_000n],
      [JUAN, 70_560_000n],
      [PEDRO, 29_400_000n],
    ]);
  });
});
