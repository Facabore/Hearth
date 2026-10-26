import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { startTestApp } from "../support/app";
import {
  activatePlan,
  addLine,
  closePlan,
  copyPlan,
  lineNamed,
  newPlan,
  putCategories,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import {
  categoryWithKey,
  cop,
  household,
  joinHousehold,
  post,
  type HouseholdMember,
} from "../support/ledger";
import {
  getLineDashboard,
  getLineTrend,
  getPersonalSpendingByGroup,
  getSpendingByGroup,
  getUnifiedView,
  spend,
  type LineTrendDto,
} from "../support/reporting";

/**
 * Ruling P249's addendum (issue #128): the server latency of the reports at household scale, measured in-process
 * through the route handlers against PostgreSQL in Docker (`pnpm perf:reports`). Three members share a 24-plan ROLLOVER
 * chain from 2024-11 to 2026-10 (2024-11 to 2026-09 closed, 2026-10 ACTIVE), with `HEARTH_LATENCY_EXPENSES` expenses
 * per period (300 by default) and 100 more in the owner's personal space in 2026-10. Each endpoint is called
 * `HEARTH_LATENCY_RUNS` times (30 by default) after three warm-up calls; p50, p95 and max are printed. The time spent
 * includes the session, Zod, the use case, the queries and reading the JSON body; it leaves out Next.js routing.
 */
const NOW = new Date("2026-10-25T17:00:00Z");
const EXPENSES = Number(process.env.HEARTH_LATENCY_EXPENSES ?? 300);
const RUNS = Number(process.env.HEARTH_LATENCY_RUNS ?? 30);
const PERSONAL_EXPENSES = 100;

/** The 24 monthly periods ending in 2026-10: 2024-11 … 2026-10. */
const PERIODS = Array.from({ length: 24 }, (_, i) => {
  const month = 10 + i; // 2024-11 is month index 10 of 2024 (0-based).
  return `${2024 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}`;
});

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(NOW) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const dayOf = (i: number) => String(1 + (i % 28)).padStart(2, "0");

/** Seeds the household and its chain; answers who reads the reports. */
const seedHousehold = async () => {
  const h = await household();
  const luis = await joinHousehold(h, "Luis", "MEMBER");
  const members: HouseholdMember[] = [h.ana, h.juan, luis];
  const keys = ["rent", "groceries", "utilities", "entertainment", "restaurants"] as const;
  const category = Object.fromEntries(
    await Promise.all(keys.map(async (key) => [key, await categoryWithKey(h.ana, key)] as const)),
  ) as Record<(typeof keys)[number], string>;
  // The first plan: capacities for the three members and four ROLLOVER lines, each mapped to its categories.
  let plan: PlanDto = await newPlan(h.ana, h.spaceId, PERIODS[0]!);
  await setCapacities(h.ana, h.spaceId, plan.id, [
    [h.ana.memberId, 3_000_000],
    [h.juan.memberId, 2_500_000],
    [luis.memberId, 1_500_000],
  ]);
  const lines: [string, number, string[]][] = [
    ["Rent", 2_000_000, [category.rent]],
    ["Home", 2_500_000, [category.groceries, category.utilities]],
    ["Free", 1_000_000, [category.entertainment]],
    ["Out", 1_000_000, [category.restaurants]],
  ];
  for (const [name, pesos] of lines)
    plan = await addLine(h.ana, h.spaceId, plan.id, { name, pesos, rolloverMode: "ROLLOVER" });
  for (const [name, , categoryIds] of lines)
    expect(
      (await putCategories(h.ana, h.spaceId, plan.id, lineNamed(plan, name).id, categoryIds)).status,
    ).toBe(200);
  const spending = [category.groceries, category.utilities, category.entertainment, category.restaurants];
  for (const [index, period] of PERIODS.entries()) {
    if (index > 0) {
      const copied = await copyPlan(h.ana, h.spaceId, period);
      expect(copied.status).toBe(201);
      plan = (await copied.json()) as PlanDto;
    }
    const activated = await activatePlan(h.ana, h.spaceId, plan.id);
    expect(activated.status).toBe(200);
    plan = (await activated.json()) as PlanDto;
    await spend(members[0]!, category.rent, 2_000_000, `${period}-01`);
    for (let i = 1; i < EXPENSES; i += 1)
      await spend(members[i % 3]!, spending[i % 4]!, 5_000 + ((i * 7_919) % 60_000), `${period}-${dayOf(i)}`);
    if (period !== "2026-10")
      expect((await closePlan(h.ana, h.spaceId, plan.id, plan.version)).status).toBe(200);
  }
  // The owner's own spending in the same month, so the unified view and the personal by group read two spaces.
  const groceries = await categoryWithKey(h.ana.personal, "groceries");
  for (let i = 0; i < PERSONAL_EXPENSES; i += 1) {
    const response = await post(recordExpense, h.ana.personal, "expenses", {
      description: "Personal",
      date: `2026-10-${dayOf(i)}`,
      categoryId: groceries,
      amount: cop(3_000 + ((i * 6_271) % 40_000)),
      accountId: h.ana.account,
    });
    expect(response.status).toBe(201);
  }
  return h;
};

/** Nearest-rank percentile of `sorted` (ascending), in ms. */
const percentile = (sorted: number[], p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;

const measure = async (name: string, request: () => Promise<Response>) => {
  for (let i = 0; i < 3; i += 1) {
    const response = await request();
    expect(response.status).toBe(200);
    await response.arrayBuffer();
  }
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    const response = await request();
    await response.arrayBuffer();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const ms = (value: number) => Math.round(value * 10) / 10;
  return {
    endpoint: name,
    runs: RUNS,
    p50: ms(percentile(samples, 0.5)),
    p95: ms(percentile(samples, 0.95)),
    max: ms(samples.at(-1)!),
  };
};

describe("report latency at household scale (issue #128, ruling P249)", () => {
  it("prints p50, p95 and max per report endpoint", async () => {
    const seeding = performance.now();
    const h = await seedHousehold();
    const seeded = Math.round((performance.now() - seeding) / 1000);
    const trend = (await (
      await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-10", periods: 24 })
    ).json()) as LineTrendDto;
    expect(trend.periods).toHaveLength(24);
    expect(trend.lines.map((l) => l.name).sort()).toEqual(["Free", "Home", "Out", "Rent"]);
    const results = [
      await measure("GET …/reports/trend?periods=24", () =>
        getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-10", periods: 24 }),
      ),
      await measure("GET …/reports/trend?periods=6", () =>
        getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-10", periods: 6 }),
      ),
      await measure("GET …/reports/lines (end of the chain)", () =>
        getLineDashboard(h.ana, h.spaceId, { period: "2026-10" }),
      ),
      await measure("GET …/reports/spending-by-group", () =>
        getSpendingByGroup(h.ana, h.spaceId, { period: "2026-10" }),
      ),
      await measure("GET /me/unified-view", () => getUnifiedView(h.ana, { period: "2026-10" })),
      await measure("GET /me/reports/spending-by-group", () =>
        getPersonalSpendingByGroup(h.ana, { period: "2026-10" }),
      ),
    ];
    console.log(
      `Seeded 3 members, 24 ROLLOVER plans, ${EXPENSES} expenses per period and ${PERSONAL_EXPENSES} personal in ${seeded} s.`,
    );
    console.table(results);
  });
});
