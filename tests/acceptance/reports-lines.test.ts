import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, startTestApp, type TestUser } from "../support/app";
import { planOf } from "../support/budgeting";
import { cop } from "../support/ledger";
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
    expect(dashboard.unbudgeted).toMatchObject({
      spent: plan.unbudgeted?.spent,
      available: plan.unbudgeted?.available,
    });
  });

  it("answers 404 SpaceNotFound for a malformed space id, never a 500", async () => {
    const r = await reportHousehold();
    const response = await getLineDashboard(r.h.ana, "not-a-uuid", { period: "2026-11" });
    expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
  });
});
