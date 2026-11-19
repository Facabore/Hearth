import { describe, expect, it } from "vitest";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { BUDGET_MEMBERS, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { unwrap } from "../../../../tests/support/fakes";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetFundContributions } from "./get-fund-contributions";
import { createGetLineDashboard } from "./get-line-dashboard";
import { createGetLineTrend } from "./get-line-trend";
import { createGetMemberLineMatrix } from "./get-member-line-matrix";

const pesos = (n: number) => BigInt(n) * 100n;
const usd = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";
const input = { spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" };

/**
 * Ruling P342 (S7), the approved "Plan del mes" board: Ana 1.600.000 COP, Juan 2.400.000 COP and 100 USD; Arriendo
 * 2.000.000 COP (shared fund), Mercado 800.000 COP, Servicios 450.000 COP, Ahorro 450.000 COP and Salidas 300.000
 * COP y 100 USD. November spends Arriendo 2.000.000, Mercado 300.000, Servicios 350.000 and Salidas 340.000 COP and
 * 45 USD.
 */
const world = async () => {
  const w = reportingWorld({ members: BUDGET_MEMBERS.slice(0, 2) });
  await w.plan("2026-11", {
    capacities: [
      { memberId: "member-ana", currency: "COP", amount: pesos(1_600_000) },
      { memberId: "member-juan", currency: "COP", amount: pesos(2_400_000) },
      { memberId: "member-juan", currency: "USD", amount: usd(100) },
    ],
    lines: [
      aLine("Arriendo", pesos(2_000_000), {
        funding: "SHARED_FUND",
        createdAt: new Date("2026-10-14T12:00:00Z"),
      }),
      aLine("Mercado", pesos(800_000), { createdAt: new Date("2026-10-14T12:01:00Z") }),
      aLine("Servicios", pesos(450_000), { createdAt: new Date("2026-10-14T12:02:00Z") }),
      aLine("Ahorro", pesos(450_000), { createdAt: new Date("2026-10-14T12:03:00Z") }),
      aLine("Salidas", 0n, {
        budgets: [
          { currency: "COP", amount: pesos(300_000) },
          { currency: "USD", amount: usd(100) },
        ],
        isCatchAll: true,
        createdAt: new Date("2026-10-14T12:04:00Z"),
      }),
    ],
    mappings: [
      { lineId: "line-arriendo", categoryId: "cat-rent" },
      { lineId: "line-mercado", categoryId: "cat-groceries" },
      { lineId: "line-servicios", categoryId: "cat-utilities" },
      { lineId: "line-salidas", categoryId: "cat-entertainment" },
    ],
  });
  w.spending.expenses[NOVEMBER] = [
    { categoryId: "cat-rent", amount: pesos(2_000_000) },
    { categoryId: "cat-groceries", amount: pesos(300_000) },
    { categoryId: "cat-utilities", amount: pesos(350_000) },
    { categoryId: "cat-entertainment", amount: pesos(340_000) },
    { categoryId: "cat-entertainment", currency: "USD", amount: usd(45) },
  ];
  return w;
};

describe("the reports of a plan per currency (ruling P342, S7)", () => {
  it("shows each line's bar per currency and the month's 'Quedan' per currency, never converted", async () => {
    const w = await world();
    const dashboard = unwrap(await createGetLineDashboard(w.deps)(input));
    const salidas = dashboard.lines.find((l) => l.name === "Salidas")!;
    expect(
      salidas.budgets.map((b) => [b.currency, b.planned, b.spent, b.available, b.state, b.overBy]),
    ).toEqual([
      ["COP", pesos(300_000), pesos(340_000), -pesos(40_000), "OVER", pesos(40_000)],
      ["USD", usd(100), usd(45), usd(55), "OK", null],
    ]);
    // The scalar figures stay the space currency's, so a client in one currency reads what it did.
    expect([salidas.planned, salidas.spent, salidas.state]).toEqual([pesos(300_000), pesos(340_000), "OVER"]);
    expect(
      dashboard.currencies.map((c) => [c.currency, c.totals.withoutSavings.available, c.totals.planned]),
    ).toEqual([
      ["COP", pesos(1_010_000), pesos(4_000_000)],
      ["USD", usd(55), usd(100)],
    ]);
    expect(dashboard.totals).toEqual(dashboard.currencies[0]!.totals);
  });

  it("lists Unbudgeted per currency, the space's as the scalar, with each currency's own categories", async () => {
    const w = await world();
    const plan = await w.plans.covering(HOUSEHOLD, NOVEMBER as never);
    // Without a catch-all, the trip's EUR dinner lands in Unbudgeted, in EUR only.
    w.plans.lines = w.plans.lines.map((r) =>
      r.line.name === "Salidas" ? { ...r, line: { ...r.line, isCatchAll: false } } : r,
    );
    w.spending.expenses[NOVEMBER]!.push({ categoryId: "cat-restaurants", currency: "EUR", amount: 3_000n });
    expect(plan).not.toBeNull();
    const dashboard = unwrap(await createGetLineDashboard(w.deps)(input));
    expect(dashboard.unbudgeted).toEqual({ spent: 0n, available: 0n, overspent: false, categoryIds: [] });
    expect(dashboard.currencies.map((c) => [c.currency, c.unbudgeted])).toEqual([
      ["COP", { spent: 0n, available: 0n, overspent: false, categoryIds: [] }],
      ["EUR", { spent: 3_000n, available: -3_000n, overspent: true, categoryIds: ["cat-restaurants"] }],
      ["USD", { spent: 0n, available: 0n, overspent: false, categoryIds: [] }],
    ]);
  });

  it("assigns and compares each member per currency in the matrix, and expects fund contributions per currency", async () => {
    const w = await world();
    w.sums.byCategory[NOVEMBER] = [
      {
        categoryId: "cat-entertainment",
        memberId: "member-juan",
        paid: usd(45),
        consumed: usd(45),
        currency: "USD",
      },
    ];
    w.sums.contributions[NOVEMBER] = [
      { memberId: "member-ana", amount: pesos(800_000) },
      { memberId: "member-juan", amount: usd(10), currency: "USD" },
    ];
    const matrix = unwrap(await createGetMemberLineMatrix(w.fundDeps)(input));
    const salidas = matrix.lines.find((l) => l.name === "Salidas")!;
    expect(
      salidas.budgets.map((b) => [b.currency, b.members.map((m) => [m.assigned, m.contributed, m.gap])]),
    ).toEqual([
      [
        "COP",
        [
          [pesos(120_000), 0n, -pesos(120_000)],
          [pesos(180_000), 0n, -pesos(180_000)],
        ],
      ],
      [
        "USD",
        [
          [0n, 0n, 0n],
          [usd(100), usd(45), -usd(55)],
        ],
      ],
    ]);
    expect(matrix.currencies.find((c) => c.currency === "USD")!.members.map((m) => m.gap)).toEqual([
      0n,
      -usd(55),
    ]);
    const fund = unwrap(await createGetFundContributions(w.fundDeps)(input));
    expect(fund.currencies.map((c) => [c.currency, c.members.map((m) => [m.expected, m.actual])])).toEqual([
      [
        "COP",
        [
          [pesos(800_000), pesos(800_000)],
          [pesos(1_200_000), 0n],
        ],
      ],
      [
        "USD",
        [
          [0n, 0n],
          [0n, usd(10)],
        ],
      ],
    ]);
    // The scalar rows stay the space currency's: the USD contribution is not added to COP.
    expect(fund.members.map((m) => m.actual)).toEqual([pesos(800_000), 0n]);
  });

  it("follows what each line spent in every currency through the trend", async () => {
    const w = await world();
    const trend = unwrap(
      await createGetLineTrend(w.deps)({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        endPeriod: "2026-11",
        periods: 1,
      }),
    );
    const salidas = trend.lines.find((l) => l.name === "Salidas")!;
    expect(salidas.points.at(-1)!.spentByCurrency).toEqual([
      { currency: "COP", spent: pesos(340_000) },
      { currency: "USD", spent: usd(45) },
    ]);
  });
});
