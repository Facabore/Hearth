import { describe, expect, it } from "vitest";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { codeOf } from "../../../../tests/support/fakes";
import type { BudgetLine, BudgetLineId, RolloverMode } from "./budget-line";
import {
  activationCheck,
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

describe("activationCheck (HU-E6-07)", () => {
  it("accepts the reference plan: its lines fit its capacity and every allocation holds", () => {
    expect(codeOf(activationCheck(figures(reference())))).toBe("ok");
  });

  it("refuses Free at 42 % / 57 %, naming it", () => {
    const allocations = [
      { lineId: "line-free", memberId: ANA, value: 4200n },
      { lineId: "line-free", memberId: JUAN, value: 5700n },
    ];
    expect(activationCheck(figures(reference({ allocations })))).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { lineIds: ["line-free"] } },
    });
  });

  it("refuses a plan whose capacity was reduced below its lines: Juan at 2,000,000 COP", () => {
    const capacities = [
      { memberId: ANA, amount: 160_000_000n },
      { memberId: JUAN, amount: 200_000_000n },
    ];
    expect(codeOf(activationCheck(figures(reference({ capacities }))))).toBe("PlanExceedsCapacity");
  });

  it("does not read spending: an overspent line neither blocks activation nor changes the answer", () => {
    const overspending: PeriodSpending = {
      byCategory: [{ categoryId: "cat-rent", amount: 150_000_000n }],
      byAccount: [],
    };
    const overspent = figures(reference(), [ANA, JUAN], overspending);
    expect(line(overspent, "Rent").available).toBe(-30_000_000n);
    expect(codeOf(activationCheck(overspent))).toBe("ok");
  });

  it("names every flagged line in plan order, and reports the capacity first when both fail", () => {
    const lines = reference().lines.map((l) =>
      l.name === "Home" ? { ...l, allocationRule: "FIXED" as const } : l,
    );
    const allocations = [
      { lineId: "line-home", memberId: ANA, value: 50_000_000n },
      { lineId: "line-free", memberId: ANA, value: 4200n },
      { lineId: "line-free", memberId: JUAN, value: 5700n },
    ];
    expect(activationCheck(figures(reference({ lines, allocations })))).toEqual({
      ok: false,
      error: { code: "InvalidAllocation", details: { lineIds: ["line-home", "line-free"] } },
    });
    const capacities = [{ memberId: ANA, amount: 100_000_000n }];
    expect(codeOf(activationCheck(figures(reference({ lines, allocations, capacities }))))).toBe(
      "PlanExceedsCapacity",
    );
  });
});

describe("carry-over (HU-E6-09)", () => {
  const groceries = [{ lineId: "line-home", categoryId: "cat-groceries" }];
  const spentOnGroceries = (amount: bigint): PeriodSpending => ({
    byCategory: [{ categoryId: "cat-groceries", amount }],
    byAccount: [],
  });
  const home = (mode: RolloverMode, overrides: Partial<BudgetLine> = {}) =>
    aLine("Home", 147_000_000n, { rolloverMode: mode, ...overrides });
  /** Home in 2026-11, spent `spent`; the figures of its 2026-12 copies `december`, before any December spending. */
  const rolled = (mode: RolloverMode, spent: bigint, december: BudgetLine[]) => {
    const nov = figures(
      reference({ lines: [home(mode)], mappings: groceries, allocations: [] }),
      [ANA, JUAN],
      spentOnGroceries(spent),
    );
    const dec = planFigures({
      currency: "COP",
      memberIds: [ANA, JUAN],
      parts: reference({ lines: december, mappings: [], allocations: [] }),
      spending: NOTHING,
      previousAvailable: nov.lines.map((l) => ({ lineId: l.line.id, available: l.available })),
    });
    return { nov, dec };
  };
  const copied = (mode: RolloverMode) =>
    home(mode, { id: "dec-home" as BudgetLineId, originLineId: "line-home" });

  it.each<[RolloverMode, bigint, bigint, bigint]>([
    ["RESET", 127_000_000n, 20_000_000n, 147_000_000n],
    ["RESET", 160_000_000n, -13_000_000n, 147_000_000n],
    ["ROLLOVER", 127_000_000n, 20_000_000n, 167_000_000n],
    ["ROLLOVER", 160_000_000n, -13_000_000n, 147_000_000n],
    ["ADJUSTED", 127_000_000n, 20_000_000n, 147_000_000n],
    ["ADJUSTED", 160_000_000n, -13_000_000n, 134_000_000n],
  ])(
    "%s, spent %s in 2026-11: November available %s, December available %s (golden outline)",
    (mode, spent, nov, dec) => {
      const result = rolled(mode, spent, [copied(mode)]);
      expect([line(result.nov, "Home").available, line(result.dec, "Home").available]).toEqual([nov, dec]);
      expect(line(result.dec, "Home").carryOver).toBe(dec - 147_000_000n);
    },
  );

  it("is decided by the receiving line's own mode, not by the line it was copied from (ruling P15)", () => {
    expect(line(rolled("RESET", 127_000_000n, [copied("ROLLOVER")]).dec, "Home").carryOver).toBe(20_000_000n);
    expect(line(rolled("ROLLOVER", 127_000_000n, [copied("RESET")]).dec, "Home").carryOver).toBe(0n);
    expect(line(rolled("ROLLOVER", 160_000_000n, [copied("ADJUSTED")]).dec, "Home").carryOver).toBe(
      -13_000_000n,
    );
  });

  it("follows the origin link, not the name: House carries Home's 200,000 COP, a new Home carries nothing", () => {
    const house = home("ROLLOVER", {
      id: "dec-house" as BudgetLineId,
      name: "House",
      originLineId: "line-home",
    });
    const newHome = home("ROLLOVER", { id: "dec-home" as BudgetLineId });
    const { dec } = rolled("ROLLOVER", 127_000_000n, [house, newHome]);
    expect(dec.lines.map((l) => [l.line.name, l.carryOver, l.available])).toEqual([
      ["House", 20_000_000n, 167_000_000n],
      ["Home", 0n, 147_000_000n],
    ]);
  });

  it("carries 0 from an origin the previous figures do not list, and nothing at all without previous figures", () => {
    const orphan = home("ROLLOVER", { id: "dec-home" as BudgetLineId, originLineId: "line-removed" });
    expect(line(rolled("ROLLOVER", 127_000_000n, [orphan]).dec, "Home").carryOver).toBe(0n);
    expect(figures(reference()).lines.map((l) => l.carryOver)).toEqual([0n, 0n, 0n, 0n]);
  });

  it.each<[string, bigint, bigint, string]>([
    ["a plan that fits its capacity", 240_000_000n, 0n, "ok"],
    ["a plan whose capacity was reduced below its lines", 200_000_000n, -40_000_000n, "PlanExceedsCapacity"],
  ])(
    "changes only available: %s keeps every other line figure, unallocated, Unbudgeted and the activation check",
    (_, juan, unallocated, activation) => {
      const lines = reference().lines.map((l) => ({
        ...l,
        isCatchAll: false,
        rolloverMode: "ROLLOVER" as const,
        originLineId: `old-${l.id}`,
      }));
      const capacities = [
        { memberId: ANA, amount: 160_000_000n },
        { memberId: JUAN, amount: juan },
      ];
      const parts = reference({ lines, capacities });
      const previousAvailable = lines.map((l) => ({ lineId: `old-${l.id}`, available: 20_000_000n }));
      const plain = figures(parts);
      const carried = planFigures({
        currency: "COP",
        memberIds: [ANA, JUAN],
        parts,
        spending: NOVEMBER,
        previousAvailable,
      });
      expect(carried.lines.map((l) => l.carryOver)).toEqual([
        20_000_000n,
        20_000_000n,
        20_000_000n,
        20_000_000n,
      ]);
      expect(carried.lines.map((l) => l.available)).toEqual(
        plain.lines.map((l) => l.available + 20_000_000n),
      );
      // Every other field of every line (line, planned, categoryIds, share, allocation, spent) is untouched.
      const sansCarry = (f: PlanFigures) => f.lines.map((l) => ({ ...l, carryOver: 0n, available: 0n }));
      expect(sansCarry(carried)).toEqual(sansCarry(plain));
      expect({ ...carried, lines: [] }).toEqual({ ...plain, lines: [] });
      expect(carried.unbudgeted).toEqual({ spent: 25_000_000n, available: -25_000_000n });
      expect([carried.planned, carried.unallocated]).toEqual([400_000_000n, unallocated]);
      expect(codeOf(activationCheck(carried))).toBe(activation);
    },
  );

  it("chains an ADJUSTED overspend through three periods exactly, and stops at the first period left in credit (Review Focus 4)", () => {
    const adjusted = (id: string, origin: string | null) =>
      home("ADJUSTED", { id: id as BudgetLineId, originLineId: origin, isCatchAll: true });
    const period = (line: BudgetLine, spent: bigint, previous?: PlanFigures) =>
      planFigures({
        currency: "COP",
        memberIds: [ANA, JUAN],
        parts: reference({ lines: [line], mappings: [], allocations: [] }),
        spending: spentOnGroceries(spent),
        previousAvailable: previous?.lines.map((l) => ({ lineId: l.line.id, available: l.available })) ?? [],
      });
    const nov = period(adjusted("nov-home", null), 160_000_000n);
    const dec = period(adjusted("dec-home", "nov-home"), 170_000_000n, nov);
    const jan = period(adjusted("jan-home", "dec-home"), 100_000_000n, dec);
    const feb = period(adjusted("feb-home", "jan-home"), 0n, jan);
    expect([nov, dec, jan, feb].map((f) => [f.lines[0]!.carryOver, f.lines[0]!.available])).toEqual([
      [0n, -13_000_000n],
      [-13_000_000n, -36_000_000n],
      [-36_000_000n, 11_000_000n],
      [0n, 147_000_000n],
    ]);
  });
});
