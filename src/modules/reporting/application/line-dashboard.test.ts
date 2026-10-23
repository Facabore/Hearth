import { describe, expect, it } from "vitest";
import type { BudgetLineId } from "@/modules/budgeting/application";
import { aLine, referenceLines } from "../../../../tests/support/budget-fixtures";
import { HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { reportingWorld } from "../../../../tests/support/reporting-world";
import { createGetLineDashboard, type LineDashboard } from "./get-line-dashboard";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";

/** Spec section 4 with Free not the catch-all (ruling P34) and the E7 mappings; Restaurants stays unmapped. */
const referenceParts = () => ({
  capacities: [
    { memberId: "member-ana", amount: pesos(1_600_000) },
    { memberId: "member-juan", amount: pesos(2_400_000) },
  ],
  lines: referenceLines().map((line) => (line.name === "Free" ? { ...line, isCatchAll: false } : line)),
  mappings: [
    { lineId: "line-rent", categoryId: "cat-rent" },
    { lineId: "line-home", categoryId: "cat-groceries" },
    { lineId: "line-home", categoryId: "cat-utilities" },
    { lineId: "line-free", categoryId: "cat-entertainment" },
  ],
});

/** HU-E7-01 Background: November 2026 by category, as the ledger sums it. */
const novemberSpending = () => [
  { categoryId: "cat-rent", amount: pesos(1_200_000) },
  { categoryId: "cat-groceries", amount: pesos(900_000) },
  { categoryId: "cat-utilities", amount: pesos(400_000) },
  { categoryId: "cat-entertainment", amount: pesos(250_000) },
  { categoryId: "cat-restaurants", amount: pesos(60_000) },
];

const read = (w: ReturnType<typeof reportingWorld>, userId = "u-ana", period = "2026-11") =>
  createGetLineDashboard(w.deps)({ spaceId: HOUSEHOLD, userId, period });
const rows = (dashboard: LineDashboard) =>
  dashboard.lines.map((l) => [l.name, l.planned, l.spent, l.available, l.overspent]);

describe("line dashboard (HU-E7-01)", () => {
  it("reports planned, spent and available per line and the unmapped spending as Unbudgeted (@golden)", async () => {
    const w = reportingWorld();
    const plan = await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = novemberSpending();
    const dashboard = unwrap(await read(w));
    expect(dashboard.plan).toEqual({ id: plan.id, status: "ACTIVE" });
    expect(dashboard.period).toEqual({ start: "2026-11-01", end: "2026-11-30", label: "2026-11" });
    expect(rows(dashboard)).toEqual([
      ["Rent", pesos(1_200_000), pesos(1_200_000), 0n, false],
      ["Home", pesos(1_470_000), pesos(1_300_000), pesos(170_000), false],
      ["Savings", pesos(600_000), 0n, pesos(600_000), false],
      ["Free", pesos(730_000), pesos(250_000), pesos(480_000), false],
    ]);
    expect(dashboard.unbudgeted).toEqual({
      spent: pesos(60_000),
      available: -pesos(60_000),
      overspent: true,
    });
  });

  it("answers the totals the summary card shows: lines plus Unbudgeted (ruling P201 of M6c)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = novemberSpending();
    expect(unwrap(await read(w)).totals).toEqual({
      planned: pesos(4_000_000),
      spent: pesos(2_810_000),
      available: pesos(1_190_000),
    });
  });

  it("totals a period without a plan from its Unbudgeted spending alone", async () => {
    const w = reportingWorld();
    w.spending.expenses["2027-01-01"] = [{ categoryId: "cat-groceries", amount: pesos(100_000) }];
    expect(unwrap(await read(w, "u-ana", "2027-01")).totals).toEqual({
      planned: 0n,
      spent: pesos(100_000),
      available: -pesos(100_000),
    });
  });

  it("names the line each category consumes: a subcategory its parent's, an unmapped one none (ruling P234 of M6c)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    expect(unwrap(await read(w)).categoryLines).toEqual([
      { categoryId: "cat-groceries", lineId: "line-home" },
      { categoryId: "cat-utilities", lineId: "line-home" },
      { categoryId: "cat-outings", lineId: null },
      { categoryId: "cat-restaurants", lineId: null },
      { categoryId: "cat-old", lineId: null },
      { categoryId: "cat-vegetables", lineId: "line-home" },
      { categoryId: "cat-meat", lineId: "line-home" },
    ]);
  });

  it("sends every unmapped category to the catch-all line, and names no line for a period without a plan", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", { ...referenceParts(), lines: referenceLines() });
    expect(unwrap(await read(w)).categoryLines).toContainEqual({
      categoryId: "cat-restaurants",
      lineId: "line-free",
    });
    expect(unwrap(await read(w, "u-ana", "2027-01")).categoryLines).toEqual([]);
  });

  it("answers each line's state against planned plus carry-over, and an overspent line's overage (ruling P244 of M6c)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = novemberSpending();
    // Rent 100 % used, Home 88.4 %, Savings is never measured, Free 34.2 %.
    expect(unwrap(await read(w)).lines.map((l) => [l.name, l.state, l.overBy])).toEqual([
      ["Rent", "HIGH", null],
      ["Home", "NEAR", null],
      ["Savings", "OK", null],
      ["Free", "OK", null],
    ]);
    w.spending.expenses[NOVEMBER] = novemberSpending().map((s) =>
      s.categoryId === "cat-groceries" ? { ...s, amount: pesos(1_200_000) } : s,
    );
    const home = unwrap(await read(w)).lines.find((l) => l.name === "Home")!;
    expect([home.available, home.state, home.overBy]).toEqual([-pesos(130_000), "OVER", pesos(130_000)]);
  });

  it("counts an expense on a subcategory of Groceries on Home's line, as the plan does (D20)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = [
      ...novemberSpending(),
      { categoryId: "cat-vegetables", amount: pesos(80_000) },
    ];
    const dashboard = unwrap(await read(w));
    expect(dashboard.lines.find((l) => l.name === "Home")).toMatchObject({
      spent: pesos(1_380_000),
      available: pesos(90_000),
    });
    expect(dashboard.unbudgeted).toEqual({
      spent: pesos(60_000),
      available: -pesos(60_000),
      overspent: true,
    });
  });

  it("flags Home as overspent once a 300,000 COP Groceries expense takes it to -130,000 COP", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses[NOVEMBER] = [
      ...novemberSpending(),
      { categoryId: "cat-groceries", amount: pesos(300_000) },
    ];
    const dashboard = unwrap(await read(w));
    expect(dashboard.lines.find((l) => l.name === "Home")).toMatchObject({
      spent: pesos(1_600_000),
      available: -pesos(130_000),
      overspent: true,
    });
    expect(dashboard.lines.filter((l) => l.overspent).map((l) => l.name)).toEqual(["Home"]);
  });

  it("includes Home's ROLLOVER carry-over of 200,000 COP from 2026-10 in its available amount", async () => {
    const w = reportingWorld();
    const october = await w.plan(
      "2026-10",
      {
        capacities: [{ memberId: "member-ana", amount: pesos(4_000_000) }],
        lines: [
          aLine("Home", pesos(1_470_000), { id: "line-home-oct" as BudgetLineId, rolloverMode: "ROLLOVER" }),
        ],
        mappings: [{ lineId: "line-home-oct", categoryId: "cat-groceries" }],
      },
      { status: "CLOSED" },
    );
    const parts = referenceParts();
    await w.plan(
      "2026-11",
      {
        ...parts,
        lines: parts.lines.map((l) =>
          l.name === "Home" ? { ...l, originLineId: "line-home-oct", rolloverMode: "ROLLOVER" as const } : l,
        ),
      },
      { createdFrom: october.id },
    );
    w.spending.expenses["2026-10-01"] = [{ categoryId: "cat-groceries", amount: pesos(1_270_000) }];
    w.spending.expenses[NOVEMBER] = novemberSpending();
    expect(unwrap(await read(w)).lines.find((l) => l.name === "Home")).toMatchObject({
      carryOver: pesos(200_000),
      available: pesos(370_000),
      state: "OK",
      overBy: null,
      carryOverFrom: { planId: october.id, period: october.period, closed: true },
    });
    // 1,340,000 of planned + carry-over (1,670,000) is 80.2 %: measured against planned alone it would read OK.
    w.spending.expenses[NOVEMBER] = novemberSpending().map((s) =>
      s.categoryId === "cat-groceries" ? { ...s, amount: pesos(940_000) } : s,
    );
    expect(unwrap(await read(w)).lines.find((l) => l.name === "Home")).toMatchObject({
      available: pesos(330_000),
      state: "NEAR",
    });
  });

  it("never measures a SAVINGS line, even one that took in transfers past its plan (ruling P244 of M6c)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.transfers[NOVEMBER] = [{ accountId: "acc-savings", amount: pesos(700_000) }];
    const savings = unwrap(await read(w)).lines.find((l) => l.name === "Savings")!;
    expect([savings.available, savings.overspent, savings.state, savings.overBy]).toEqual([
      -pesos(100_000),
      true,
      "OK",
      null,
    ]);
  });

  it.each(["DRAFT", "ACTIVE"] as const)(
    "carries nothing from a %s 2026-10 and says it waits for that plan (ruling P243 of M6c)",
    async (status) => {
      const w = reportingWorld();
      const october = await w.plan(
        "2026-10",
        {
          capacities: [{ memberId: "member-ana", amount: pesos(4_000_000) }],
          lines: [
            aLine("Home", pesos(1_470_000), {
              id: "line-home-oct" as BudgetLineId,
              rolloverMode: "ROLLOVER",
            }),
          ],
          mappings: [{ lineId: "line-home-oct", categoryId: "cat-groceries" }],
        },
        { status },
      );
      const parts = referenceParts();
      await w.plan(
        "2026-11",
        {
          ...parts,
          lines: parts.lines.map((l) =>
            l.name === "Home"
              ? { ...l, originLineId: "line-home-oct", rolloverMode: "ROLLOVER" as const }
              : l,
          ),
        },
        { createdFrom: october.id },
      );
      w.spending.expenses["2026-10-01"] = [{ categoryId: "cat-groceries", amount: pesos(1_270_000) }];
      w.spending.expenses[NOVEMBER] = novemberSpending();
      const dashboard = unwrap(await read(w));
      expect(dashboard.lines.find((l) => l.name === "Home")).toMatchObject({
        carryOver: 0n,
        carryOverFrom: { planId: october.id, period: october.period, closed: false },
      });
      expect(dashboard.lines.filter((l) => l.name !== "Home").map((l) => l.carryOverFrom)).toEqual([
        null,
        null,
        null,
      ]);
    },
  );

  it("reports every expense of a period without a plan under Unbudgeted, and that no plan exists", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    w.spending.expenses["2027-01-01"] = [
      { categoryId: "cat-groceries", amount: pesos(100_000) },
      { categoryId: "cat-restaurants", amount: pesos(60_000) },
    ];
    const dashboard = unwrap(await read(w, "u-ana", "2027-01"));
    expect(dashboard).toMatchObject({
      plan: null,
      lines: [],
      period: { label: "2027-01", start: "2027-01-01", end: "2027-01-31" },
    });
    expect(dashboard.unbudgeted).toEqual({
      spent: pesos(160_000),
      available: -pesos(160_000),
      overspent: true,
    });
  });

  it("has no Unbudgeted entry when the plan has a catch-all line, which consumes the unmapped spending", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", { ...referenceParts(), lines: referenceLines() });
    w.spending.expenses[NOVEMBER] = novemberSpending();
    const dashboard = unwrap(await read(w));
    expect(dashboard.unbudgeted).toBeNull();
    // The catch-all line consumes Restaurants, so the totals are the lines' alone.
    expect(dashboard.totals).toEqual({
      planned: pesos(4_000_000),
      spent: pesos(2_810_000),
      available: pesos(1_190_000),
    });
    expect(dashboard.lines.find((l) => l.name === "Free")).toMatchObject({
      isCatchAll: true,
      spent: pesos(310_000),
      available: pesos(420_000),
    });
  });

  it("reports a DRAFT plan's figures as well, whatever its status (ruling P33)", async () => {
    const w = reportingWorld();
    const plan = await w.plan("2026-11", referenceParts(), { status: "DRAFT" });
    w.spending.expenses[NOVEMBER] = novemberSpending();
    const dashboard = unwrap(await read(w));
    expect(dashboard.plan).toEqual({ id: plan.id, status: "DRAFT" });
    expect(dashboard.lines.map((l) => l.name)).toEqual(["Rent", "Home", "Savings", "Free"]);
  });

  it("lets every member read it, VIEWER Sofi included, and an archived space too (HU-E1-09)", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    expect(unwrap(await read(w, "u-sofi")).lines).toHaveLength(4);
    w.spaces.archived.add(HOUSEHOLD);
    expect(unwrap(await read(w, "u-juan")).lines).toHaveLength(4);
  });

  it("hides the space from non-members and malformed ids, and refuses labels the policy does not name", async () => {
    const w = reportingWorld();
    await w.plan("2026-11", referenceParts());
    expect(codeOf(await read(w, "u-marta"))).toBe("SpaceNotFound");
    const malformed = await createGetLineDashboard(w.deps)({
      spaceId: "not-a-uuid",
      userId: "u-ana",
      period: "2026-11",
    });
    expect(codeOf(malformed)).toBe("SpaceNotFound");
    for (const label of ["2026-13", "2026-11 H1", "November"]) {
      expect(codeOf(await read(w, "u-ana", label))).toBe("InvalidPeriodLabel");
    }
  });
});
