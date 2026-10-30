import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as linesRoute } from "@/app/api/v1/spaces/[spaceId]/reports/lines/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { copyPlan, lineNamed, patchLine, planOf, type PlanDto } from "../support/budgeting";
import { cop, joinHousehold, post } from "../support/ledger";
import { getLineDashboard, reportHousehold, spend, type LineDashboardDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

type ReportHousehold = Awaited<ReturnType<typeof reportHousehold>>;

/** HU-E7-01 Background: November 2026's expenses; Restaurants on the period's last day. */
const novemberExpenses = async ({ h, category, fund }: ReportHousehold) => {
  await spend(h.ana, category.rent, 1_200_000, "2026-11-01", fund);
  await spend(h.ana, category.groceries, 900_000, "2026-11-05");
  await spend(h.juan, category.utilities, 400_000, "2026-11-10");
  await spend(h.juan, category.entertainment, 250_000, "2026-11-15");
  await spend(h.ana, category.restaurants, 60_000, "2026-11-30");
};

const dashboardOf = async (user: TestUser, spaceId: string, period: string): Promise<LineDashboardDto> => {
  const response = await getLineDashboard(user, spaceId, { period });
  expect(response.status).toBe(200);
  return (await response.json()) as LineDashboardDto;
};

describe("line dashboard over HTTP (HU-E7-01)", () => {
  it("reports planned, spent and available per line, and Restaurants as Unbudgeted (@critical @golden)", async () => {
    const r = await reportHousehold();
    await novemberExpenses(r);
    // Review Focus 2: the next period's first day is not November's.
    await spend(r.h.ana, r.category.groceries, 70_000, "2026-12-01");
    const dashboard = await dashboardOf(r.h.ana, r.h.spaceId, "2026-11");
    expect(dashboard.plan).toEqual({ id: r.planId, status: "DRAFT" });
    expect(dashboard.period).toEqual({ label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" });
    expect(dashboard.lines.map((l) => [l.name, l.planned, l.spent, l.available, l.overspent])).toEqual([
      ["Rent", cop(1_200_000), cop(1_200_000), cop(0), false],
      ["Home", cop(1_470_000), cop(1_300_000), cop(170_000), false],
      ["Savings", cop(600_000), cop(0), cop(600_000), false],
      ["Free", cop(730_000), cop(250_000), cop(480_000), false],
    ]);
    expect(dashboard.unbudgeted).toEqual({ spent: cop(60_000), available: cop(-60_000), overspent: true });
    expect(dashboard.totals).toEqual({
      planned: cop(4_000_000),
      spent: cop(2_810_000),
      available: cop(1_190_000),
      saved: cop(0),
      withoutSavings: { planned: cop(3_400_000), spent: cop(2_810_000) },
    });
    expect(dashboard.categoryLines).toContainEqual({
      categoryId: r.category.groceries,
      lineId: r.lineId("Home"),
    });
    expect(dashboard.categoryLines).toContainEqual({ categoryId: r.category.restaurants, lineId: null });
    expect(dashboard.lines.map((l) => [l.name, l.state, l.overBy])).toEqual([
      ["Rent", "HIGH", null],
      ["Home", "NEAR", null],
      ["Savings", "OK", null],
      ["Free", "OK", null],
    ]);
  });

  it("shows each line's figures exactly as the plan view does, carry-over included (P32)", async () => {
    const r = await reportHousehold();
    await novemberExpenses(r);
    const dashboard = await dashboardOf(r.h.ana, r.h.spaceId, "2026-11");
    const plan = await planOf(r.h.ana, r.h.spaceId, r.planId);
    expect(dashboard.lines.map((l) => [l.lineId, l.planned, l.spent, l.carryOver, l.available])).toEqual(
      plan.lines.map((l) => [l.id, l.plannedAmount, l.spent, l.carryOver, l.available]),
    );
    expect(dashboard.lines.map((l) => l.carryOver)).toEqual([cop(0), cop(0), cop(0), cop(0)]);
    // Both answers agree on where a carry-over comes from too; a plan that was not copied names no source (ruling P243).
    expect(dashboard.lines.map((l) => l.carryOverFrom)).toEqual(plan.lines.map((l) => l.carryOverFrom));
    expect(dashboard.lines.map((l) => l.carryOverFrom)).toEqual([null, null, null, null]);
    expect(dashboard.unbudgeted).toMatchObject({
      spent: plan.unbudgeted?.spent,
      available: plan.unbudgeted?.available,
    });
  });

  it("names the plan a copy's carry-over waits for: a DRAFT 2026-11 carries nothing into 2026-12 (ruling P243 of M6c)", async () => {
    const r = await reportHousehold();
    await novemberExpenses(r);
    const { h, planId, lineId } = r;
    expect(
      (await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { rolloverMode: "ROLLOVER" })).status,
    ).toBe(200);
    const copied = await copyPlan(h.ana, h.spaceId, "2026-12");
    expect(copied.status).toBe(201);
    const december = (await copied.json()) as PlanDto;
    const dashboard = await dashboardOf(h.ana, h.spaceId, "2026-12");
    const home = dashboard.lines.find((l) => l.name === "Home")!;
    expect(home.carryOver).toEqual(cop(0));
    expect(home.carryOverFrom).toEqual({
      planId,
      period: { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" },
      closed: false,
    });
    expect(dashboard.lines.filter((l) => l.name !== "Home").map((l) => l.carryOverFrom)).toEqual([
      null,
      null,
      null,
    ]);
    // The plan view of the same copy answers the same source, line by line.
    expect(lineNamed(december, "Home").carryOverFrom).toEqual(home.carryOverFrom);
  });

  it("answers 404 SpaceNotFound for a malformed space id, never a 500", async () => {
    const r = await reportHousehold();
    const response = await getLineDashboard(r.h.ana, "not-a-uuid", { period: "2026-11" });
    expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
  });

  it("flags Home as overspent after a 300,000 COP Groceries expense on 2026-11-20", async () => {
    const r = await reportHousehold();
    await novemberExpenses(r);
    await spend(r.h.ana, r.category.groceries, 300_000, "2026-11-20");
    const home = (await dashboardOf(r.h.juan, r.h.spaceId, "2026-11")).lines.find((l) => l.name === "Home");
    expect(home).toMatchObject({ spent: cop(1_600_000), available: cop(-130_000), overspent: true });
  });

  it("answers plan null and reports every expense under Unbudgeted for 2027-01, which has no plan", async () => {
    const r = await reportHousehold();
    await spend(r.h.ana, r.category.groceries, 100_000, "2027-01-10");
    const dashboard = await dashboardOf(r.h.ana, r.h.spaceId, "2027-01");
    expect(dashboard).toMatchObject({ plan: null, lines: [], period: { label: "2027-01" } });
    expect(dashboard.unbudgeted).toEqual({ spent: cop(100_000), available: cop(-100_000), overspent: true });
    expect(dashboard.totals).toEqual({
      planned: cop(0),
      spent: cop(100_000),
      available: cop(-100_000),
      saved: cop(0),
      withoutSavings: { planned: cop(0), spent: cop(100_000) },
    });
    expect(dashboard.categoryLines).toEqual([]);
  });

  it("keeps a 200,000 COP transfer into Ana's Ahorros apart from what was spent (#214, ruling P262)", async () => {
    const r = await reportHousehold();
    await novemberExpenses(r);
    const transfer = await post(recordTransfer, r.h.ana.personal, "transfers", {
      description: "Ahorro",
      date: "2026-11-06",
      amount: cop(200_000),
      sourceAccountId: r.h.ana.account,
      destinationAccountId: r.savings,
    });
    expect(transfer.status).toBe(201);
    const dashboard = await dashboardOf(r.h.juan, r.h.spaceId, "2026-11");
    expect(dashboard.lines.find((l) => l.name === "Savings")?.spent).toEqual(cop(200_000));
    // spent keeps its meaning for existing clients: the savings are in it, as before.
    expect(dashboard.totals).toEqual({
      planned: cop(4_000_000),
      spent: cop(3_010_000),
      available: cop(990_000),
      saved: cop(200_000),
      withoutSavings: { planned: cop(3_400_000), spent: cop(2_810_000) },
    });
  });

  it("answers 401 without a session, before it looks at the space or the period (issue 131)", async () => {
    const r = await reportHousehold();
    for (const query of ["period=2026-11", "period=not-a-period", ""]) {
      const anonymous = await call(
        linesRoute,
        "GET",
        `/api/v1/spaces/${r.h.spaceId}/reports/lines?${query}`,
        { params: { spaceId: r.h.spaceId } },
      );
      expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    }
    expect((await dashboardOf(r.h.ana, r.h.spaceId, "2026-11")).period.label).toBe("2026-11");
  });

  it("lets VIEWER Sofi read it and hides the space from non-members and malformed ids", async () => {
    const r = await reportHousehold();
    const sofi = await joinHousehold(r.h, "Sofi", "VIEWER");
    expect((await dashboardOf(sofi, r.h.spaceId, "2026-11")).lines).toHaveLength(4);
    const marta = await registerUser("Marta");
    expect(await problemOf(await getLineDashboard(marta, r.h.spaceId, { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await problemOf(await getLineDashboard(r.h.ana, "not-a-uuid", { period: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("refuses a missing period and a label the space policy does not name", async () => {
    const r = await reportHousehold();
    expect(await problemOf(await getLineDashboard(r.h.ana, r.h.spaceId, {}))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await getLineDashboard(r.h.ana, r.h.spaceId, { period: "2026-11 H1" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
  });
});
