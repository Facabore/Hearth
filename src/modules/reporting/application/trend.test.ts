import { describe, expect, it, vi } from "vitest";
import type { BudgetLineId, BudgetPlanId, RolloverMode } from "@/modules/budgeting/application";
import type { SpaceId } from "@/modules/spaces/application";
import { fromParts, type PeriodPolicy } from "@/shared/kernel";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { place, personalWorld } from "../../../../tests/support/personal-world";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetLineTrend, type LineTrend } from "./get-line-trend";
import { createGetPersonalTrend } from "./get-personal-trend";

const pesos = (n: number) => BigInt(n) * 100n;
const capacities = [{ memberId: "member-ana", amount: pesos(4_000_000) }];

/**
 * Household with a chain of copied plans: Home in each `label`, mapped to Groceries, copied from the previous one,
 * with `rolloverMode` (RESET unless given), and the Groceries spending of each period by its first day.
 */
const chain = async (
  policy: PeriodPolicy,
  spentFrom: readonly (readonly [string, string, number])[],
  rolloverMode: RolloverMode = "RESET",
) => {
  const w = reportingWorld({ periodPolicy: policy });
  let previous: { planId: string; lineId: string } | null = null;
  for (const [label, from, spent] of spentFrom) {
    const lineId = `line-home-${from}`;
    const plan = await w.plan(
      label,
      {
        capacities,
        lines: [
          aLine("Home", pesos(1_470_000), {
            id: lineId as BudgetLineId,
            originLineId: previous?.lineId ?? null,
            rolloverMode,
          }),
        ],
        mappings: [{ lineId, categoryId: "cat-groceries" }],
      },
      { createdFrom: previous?.planId },
    );
    w.spending.expenses[from] = [{ categoryId: "cat-groceries", amount: pesos(spent) }];
    previous = { planId: plan.id, lineId };
  }
  return w;
};
const trendOf = (w: Awaited<ReturnType<typeof chain>>, endPeriod: string, periods = 6, userId = "u-ana") =>
  createGetLineTrend(w.deps)({ spaceId: HOUSEHOLD, userId, endPeriod, periods });
const points = (trend: LineTrend, name: string) =>
  trend.lines
    .find((l) => l.name === name)!
    .points.map((p) => [
      p.period.label,
      p.spent,
      p.change?.amount ?? null,
      p.change?.basisPoints ?? null,
      p.change?.status ?? null,
    ]);

describe("line trend (HU-E7-05)", () => {
  it("gives Home's change versus the previous period: -50,000 COP (-3.70 %)", async () => {
    const w = await chain({ kind: "MONTHLY", day: 1 }, [
      ["2026-10", "2026-10-01", 1_350_000],
      ["2026-11", "2026-11-01", 1_300_000],
    ]);
    const trend = unwrap(await trendOf(w, "2026-11", 2));
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-10", "2026-11"]);
    expect(points(trend, "Home")).toEqual([
      ["2026-10", pesos(1_350_000), null, null, "NEW"],
      ["2026-11", pesos(1_300_000), -pesos(50_000), -370, "DECREASED"],
    ]);
  });

  it("compares semi-monthly periods with the previous half-month", async () => {
    const w = await chain({ kind: "SEMI_MONTHLY", day1: 1, day2: 16 }, [
      ["2026-10 H2", "2026-10-16", 400_000],
      ["2026-11 H1", "2026-11-01", 500_000],
      ["2026-11 H2", "2026-11-16", 450_000],
    ]);
    expect(points(unwrap(await trendOf(w, "2026-11 H2", 2)), "Home")).toEqual([
      ["2026-11 H1", pesos(500_000), pesos(100_000), 2_500, "INCREASED"],
      ["2026-11 H2", pesos(450_000), -pesos(50_000), -1_000, "DECREASED"],
    ]);
  });

  it("marks Pets, a line only in the 2026-11 plan, NEW with no percentage, and earlier periods without a figure", async () => {
    const w = reportingWorld();
    const october = await w.plan("2026-10", {
      capacities,
      lines: [aLine("Home", pesos(1_470_000), { id: "line-home-oct" as BudgetLineId })],
    });
    await w.plan(
      "2026-11",
      {
        capacities,
        lines: [
          aLine("Home", pesos(1_470_000), { originLineId: "line-home-oct" }),
          aLine("Pets", pesos(100_000)),
        ],
        mappings: [{ lineId: "line-pets", categoryId: "cat-pets" }],
      },
      { createdFrom: october.id },
    );
    w.spending.expenses["2026-11-01"] = [{ categoryId: "cat-pets", amount: pesos(80_000) }];
    const trend = unwrap(await trendOf(w, "2026-11", 3));
    expect(points(trend, "Pets")).toEqual([
      ["2026-09", null, null, null, null],
      ["2026-10", null, null, null, null],
      ["2026-11", pesos(80_000), null, null, "NEW"],
    ]);
    expect(points(trend, "Home").map((p) => p[1])).toEqual([null, 0n, 0n]);
  });

  it("has no lines when the end period has no plan, and six periods by default", async () => {
    const w = reportingWorld();
    const trend = unwrap(await trendOf(w, "2026-11"));
    expect(trend).toMatchObject({ plan: null, lines: [] });
    expect(trend.periods.map((p) => p.label)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  it("shows the window the end period names: one point per period shown, the one compared with only before them", async () => {
    const w = await chain({ kind: "MONTHLY", day: 1 }, [
      ["2026-08", "2026-08-01", 1_000_000],
      ["2026-09", "2026-09-01", 1_100_000],
      ["2026-10", "2026-10-01", 1_210_000],
    ]);
    const trend = unwrap(await trendOf(w, "2026-10", 2));
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-09", "2026-10"]);
    expect(points(trend, "Home")).toEqual([
      ["2026-09", pesos(1_100_000), pesos(100_000), 1_000, "INCREASED"],
      ["2026-10", pesos(1_210_000), pesos(110_000), 1_000, "INCREASED"],
    ]);
  });

  it("follows a stored period that shares its label with the derived stub before it, labelling the stub apart (#132)", async () => {
    // A stored 2026-10 of Oct 5 to Nov 4 leaves Oct 1-4 as a derived period that is also labelled 2026-10 (HU-E1-03).
    const w = reportingWorld();
    const october = await w.plan("2026-10", {
      capacities,
      lines: [aLine("Home", pesos(1_470_000), { id: "line-home-oct" as BudgetLineId })],
      mappings: [{ lineId: "line-home-oct", categoryId: "cat-groceries" }],
    });
    w.plans.plans = w.plans.plans.map((p) =>
      p.id === october.id
        ? { ...p, period: { start: fromParts(2026, 10, 5), end: fromParts(2026, 11, 4), label: "2026-10" } }
        : p,
    );
    await w.plan(
      "2026-11",
      {
        capacities,
        lines: [
          aLine("Home", pesos(1_470_000), {
            id: "line-home-nov" as BudgetLineId,
            originLineId: "line-home-oct",
          }),
        ],
        mappings: [{ lineId: "line-home-nov", categoryId: "cat-groceries" }],
      },
      { createdFrom: october.id },
    );
    w.spending.expenses["2026-10-01"] = [{ categoryId: "cat-groceries", amount: pesos(999_999) }];
    w.spending.expenses["2026-10-05"] = [{ categoryId: "cat-groceries", amount: pesos(1_000_000) }];
    w.spending.expenses["2026-11-05"] = [{ categoryId: "cat-groceries", amount: pesos(1_100_000) }];
    const trend = unwrap(await trendOf(w, "2026-11", 3));
    // Ruling of #132: the stored period keeps the label, the stub it shares it with is written apart.
    expect(trend.periods.map((p) => [p.label, p.start, p.end])).toEqual([
      ["2026-10 (2026-10-01..2026-10-04)", "2026-10-01", "2026-10-04"],
      ["2026-10", "2026-10-05", "2026-11-04"],
      ["2026-11", "2026-11-05", "2026-11-30"],
    ]);
    expect(points(trend, "Home")).toEqual([
      ["2026-10 (2026-10-01..2026-10-04)", null, null, null, null],
      ["2026-10", pesos(1_000_000), null, null, "NEW"],
      ["2026-11", pesos(1_100_000), pesos(100_000), 1_000, "INCREASED"],
    ]);
  });

  it("keeps every label of a window without a stub as the policy names it (#132)", async () => {
    const w = await chain({ kind: "MONTHLY", day: 1 }, [
      ["2026-10", "2026-10-01", 1_350_000],
      ["2026-11", "2026-11-01", 1_300_000],
    ]);
    const trend = unwrap(await trendOf(w, "2026-11", 2));
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-10", "2026-11"]);
    expect(trend.lines[0]!.points.map((p) => p.period.label)).toEqual(["2026-10", "2026-11"]);
  });

  it("keeps a line's trace across a period without a plan (P98): Aug's House is Oct's Home, Sep has no figure", async () => {
    const w = reportingWorld();
    const august = await w.plan("2026-08", {
      capacities,
      lines: [aLine("House", pesos(1_000_000), { id: "line-house-aug" as BudgetLineId })],
      mappings: [{ lineId: "line-house-aug", categoryId: "cat-groceries" }],
    });
    await w.plan(
      "2026-10",
      {
        capacities,
        lines: [
          aLine("Home", pesos(1_000_000), {
            id: "line-home-oct" as BudgetLineId,
            originLineId: "line-house-aug",
          }),
        ],
        mappings: [{ lineId: "line-home-oct", categoryId: "cat-groceries" }],
      },
      { createdFrom: august.id },
    );
    w.spending.expenses["2026-08-01"] = [{ categoryId: "cat-groceries", amount: pesos(900_000) }];
    w.spending.expenses["2026-10-01"] = [{ categoryId: "cat-groceries", amount: pesos(990_000) }];
    const trend = unwrap(await trendOf(w, "2026-10", 3));
    expect(points(trend, "Home")).toEqual([
      ["2026-08", pesos(900_000), null, null, "NEW"],
      ["2026-09", null, null, null, null],
      ["2026-10", pesos(990_000), null, null, "NEW"],
    ]);
  });

  it("takes a line's spending from the plan view: an expense in a subcategory counts on its parent's line (P32)", async () => {
    const w = await chain({ kind: "MONTHLY", day: 1 }, [
      ["2026-10", "2026-10-01", 1_350_000],
      ["2026-11", "2026-11-01", 0],
    ]);
    // Home maps to Groceries; the November spending is recorded on Vegetables, one of its subcategories.
    w.spending.expenses["2026-11-01"] = [{ categoryId: "cat-vegetables", amount: pesos(1_300_000) }];
    expect(points(unwrap(await trendOf(w, "2026-11", 2)), "Home")).toEqual([
      ["2026-10", pesos(1_350_000), null, null, "NEW"],
      ["2026-11", pesos(1_300_000), -pesos(50_000), -370, "DECREASED"],
    ]);
  });

  it.each([6, 24])(
    "figures each plan of a 30-plan carry-over chain once for a %i-period trend, not once per view (ruling P105)",
    async (periods) => {
      // Two and a half years of monthly copies, 2024-06 to 2026-11, whose Home rolls its leftover over each month.
      const months = Array.from({ length: 30 }, (_, i) => {
        const year = 2024 + Math.floor((5 + i) / 12);
        const month = String(((5 + i) % 12) + 1).padStart(2, "0");
        return [`${year}-${month}`, `${year}-${month}-01`, 1_000_000 + i * 10_000] as const;
      });
      const w = await chain({ kind: "MONTHLY", day: 1 }, months, "ROLLOVER");
      const contents = vi.spyOn(w.plans, "contents");
      const find = vi.spyOn(w.plans, "find");
      const members = vi.spyOn(w.spaces, "listCurrent");
      w.spending.expensesAsked.length = 0;
      const trend = unwrap(await trendOf(w, "2026-11", periods));
      expect(points(trend, "Home").map((p) => p[1])).toEqual(
        months.slice(-periods).map(([, , spent]) => pesos(spent)),
      );
      // Every plan of the chain is figured once, whatever the window: 30 plans, 29 of them copies of the one before.
      expect(contents).toHaveBeenCalledTimes(30);
      expect(find).toHaveBeenCalledTimes(29);
      expect(w.spending.expensesAsked).toHaveLength(30);
      expect(members).toHaveBeenCalledTimes(1);
    },
  );

  it("reads the space's stored periods once: the window reuses the ones that resolved the end period", async () => {
    const w = await chain({ kind: "MONTHLY", day: 1 }, [
      ["2026-10", "2026-10-01", 1_350_000],
      ["2026-11", "2026-11-01", 1_300_000],
    ]);
    const stored = vi.spyOn(w.plans, "storedPeriods");
    unwrap(await trendOf(w, "2026-11", 2));
    expect(stored).toHaveBeenCalledTimes(1);
  });

  it("hides the space from non-members and refuses an end period the policy does not name", async () => {
    const w = reportingWorld();
    expect(codeOf(await trendOf(w, "2026-11", 6, "u-marta"))).toBe("SpaceNotFound");
    expect(codeOf(await trendOf(w, "2026-11 H1"))).toBe("InvalidPeriodLabel");
  });
});

describe("personal trend (HU-E7-05)", () => {
  it("returns six personal consumption values from 2026-06 to 2026-11, each compared with the one before", async () => {
    const w = personalWorld();
    const byMonth: Record<string, number> = {
      "2026-05-01": 100_000,
      "2026-06-01": 200_000,
      "2026-07-01": 150_000,
      "2026-08-01": 150_000,
      "2026-09-01": 300_000,
      "2026-10-01": 270_000,
      "2026-11-01": 297_000,
    };
    for (const [from, amount] of Object.entries(byMonth)) {
      w.sums.consumption[from] = [
        { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(amount) },
      ];
    }
    const trend = unwrap(
      await createGetPersonalTrend(w.deps)({ userId: "u-ana", endPeriod: "2026-11", periods: 6 }),
    );
    expect(
      trend.points.map((p) => [p.period.label, p.consumption, p.change.basisPoints, p.change.status]),
    ).toEqual([
      ["2026-06", pesos(200_000), 10_000, "INCREASED"],
      ["2026-07", pesos(150_000), -2_500, "DECREASED"],
      ["2026-08", pesos(150_000), 0, "UNCHANGED"],
      ["2026-09", pesos(300_000), 10_000, "INCREASED"],
      ["2026-10", pesos(270_000), -1_000, "DECREASED"],
      ["2026-11", pesos(297_000), 1_000, "INCREASED"],
    ]);
  });

  it("reports 0 for a personal period without consumption, and NEW after it", async () => {
    const w = personalWorld();
    w.sums.consumption["2026-11-01"] = [
      { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(50_000) },
    ];
    const trend = unwrap(
      await createGetPersonalTrend(w.deps)({ userId: "u-ana", endPeriod: "2026-11", periods: 2 }),
    );
    expect(trend.points.map((p) => [p.period.label, p.consumption, p.change.status])).toEqual([
      ["2026-10", 0n, "NEW"],
      ["2026-11", pesos(50_000), "NEW"],
    ]);
  });
  it("labels the derived stub apart when a stored personal period shares its label, keeping points aligned with periods (#132)", async () => {
    const w = personalWorld();
    w.plans.plans.push({
      id: "plan-ana-oct" as BudgetPlanId,
      spaceId: "space-ana" as SpaceId,
      period: { start: fromParts(2026, 10, 5), end: fromParts(2026, 11, 4), label: "2026-10" },
      status: "ACTIVE",
      createdFrom: null,
      version: 1,
      createdBy: "u-ana",
      createdAt: new Date("2026-10-05T12:00:00Z"),
    });
    w.sums.consumption["2026-10-01"] = [
      { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(30_000) },
    ];
    w.sums.consumption["2026-10-05"] = [
      { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(270_000) },
    ];
    const trend = unwrap(
      await createGetPersonalTrend(w.deps)({ userId: "u-ana", endPeriod: "2026-11", periods: 3 }),
    );
    expect(trend.periods.map((p) => [p.label, p.start, p.end])).toEqual([
      ["2026-10 (2026-10-01..2026-10-04)", "2026-10-01", "2026-10-04"],
      ["2026-10", "2026-10-05", "2026-11-04"],
      ["2026-11", "2026-11-05", "2026-11-30"],
    ]);
    expect(trend.points.map((p) => [p.period.label, p.consumption])).toEqual([
      ["2026-10 (2026-10-01..2026-10-04)", pesos(30_000)],
      ["2026-10", pesos(270_000)],
      ["2026-11", 0n],
    ]);
    expect(trend.points.map((p) => p.period)).toEqual(trend.periods);
  });

  it("reads only the caller's own member rows of the personal space's currency, one question per period of the window", async () => {
    const w = personalWorld([
      place("space-ana", "member-ana-personal", "Personal", { spaceKind: "PERSONAL" }),
      place("space-household", "member-ana", "Household"),
      place("space-abroad", "member-ana-abroad", "Abroad", { currency: "USD" }),
    ]);
    const trend = unwrap(
      await createGetPersonalTrend(w.deps)({ userId: "u-ana", endPeriod: "2026-11", periods: 3 }),
    );
    expect(trend.points).toHaveLength(3);
    expect(w.sums.asked.map((q) => [q.from, q.to])).toEqual([
      ["2026-08-01", "2026-08-31"],
      ["2026-09-01", "2026-09-30"],
      ["2026-10-01", "2026-10-31"],
      ["2026-11-01", "2026-11-30"],
    ]);
    for (const question of w.sums.asked)
      expect(question.memberIds).toEqual(["member-ana-personal", "member-ana"]);
  });

  it("hides the personal trend from a user without a personal space and refuses a label the policy does not name", async () => {
    const w = personalWorld();
    const trendOfUser = (userId: string, endPeriod: string) =>
      createGetPersonalTrend(w.deps)({ userId, endPeriod, periods: 6 });
    expect(codeOf(await trendOfUser("u-marta", "2026-11"))).toBe("SpaceNotFound");
    expect(codeOf(await trendOfUser("u-ana", "2026-11 H1"))).toBe("InvalidPeriodLabel");
    expect(w.sums.asked).toEqual([]);
  });
});
