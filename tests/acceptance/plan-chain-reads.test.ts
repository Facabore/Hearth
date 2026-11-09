import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getPlanRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/route";
import { GET as fundRoute } from "@/app/api/v1/spaces/[spaceId]/reports/fund-contributions/route";
import { GET as linesRoute } from "@/app/api/v1/spaces/[spaceId]/reports/lines/route";
import { GET as matrixRoute } from "@/app/api/v1/spaces/[spaceId]/reports/member-matrix/route";
import { GET as trendRoute } from "@/app/api/v1/spaces/[spaceId]/reports/trend/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, startTestApp, type RouteHandler } from "../support/app";
import {
  activatePlan,
  addLine,
  closePlan,
  copyPlan,
  lineNamed,
  newPlan,
  putCategories,
  setCapacities,
} from "../support/budgeting";
import { household, newAccount, starterAccount, type Household } from "../support/ledger";
import { spend } from "../support/reporting";
import { statementsDuring } from "../support/sql-statements";

// Every period of the chains below is over, so each plan but the last can be closed.
const NOW = new Date("2027-03-15T15:00:00Z");

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(NOW) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

const accepted = async (response: Response) => {
  if (response.status >= 300) throw new Error(`status ${response.status}: ${await response.text()}`);
  return response;
};

/**
 * A household whose plans are copies of the first, one per month of `months`, each closed but the last, with Home and
 * Free carrying over (ROLLOVER), the Rent fund line and a Savings line; the spending of every month is recorded
 * before its plan closes. The last plan's view walks back through every earlier one.
 */
const chainOf = async (months: readonly string[]): Promise<{ h: Household; planId: string }> => {
  const h = await household();
  const savings = await starterAccount(h.ana.personal, "Ahorros");
  const fund = await newAccount(h.ana, "Household Fund", 1_500_000, "SHARED_FUND");
  const first = await newPlan(h.ana, h.spaceId, months[0]!);
  await setCapacities(h.ana, h.spaceId, first.id, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  const add = (line: Parameters<typeof addLine>[3]) => addLine(h.ana, h.spaceId, first.id, line);
  await add({ name: "Rent", pesos: 1_200_000, funding: "SHARED_FUND", rolloverMode: "RESET" });
  await add({ name: "Home", pesos: 1_470_000, funding: "DIRECT", rolloverMode: "ROLLOVER" });
  await add({
    name: "Savings",
    pesos: 600_000,
    funding: "SAVINGS",
    rolloverMode: "RESET",
    savingsAccountIds: [savings],
  });
  const plan = await add({ name: "Free", pesos: 730_000, funding: "DIRECT", rolloverMode: "ROLLOVER" });
  await accepted(await putCategories(h.ana, h.spaceId, first.id, lineNamed(plan, "Home").id, [h.groceries]));
  await accepted(await activatePlan(h.ana, h.spaceId, first.id));
  for (const [i, month] of months.entries()) {
    await spend(h.ana, h.groceries, 300_000 + i * 10_000, `${month}-05`);
    await spend(h.juan, h.groceries, 200_000, `${month}-12`, fund);
  }
  let previous = first.id;
  for (const month of months.slice(1)) {
    const copied = await accepted(await copyPlan(h.ana, h.spaceId, month));
    const { id } = (await copied.json()) as { id: string };
    await accepted(await closePlan(h.ana, h.spaceId, previous));
    await accepted(await activatePlan(h.ana, h.spaceId, id));
    previous = id;
  }
  return { h, planId: previous };
};

/** The reads of the last plan's period, each as Ana asks it: [name, handler, path, params]. */
const readsOf = ({ h, planId }: { h: Household; planId: string }, period: string) => {
  const space = `/api/v1/spaces/${h.spaceId}`;
  const params = { spaceId: h.spaceId };
  return [
    ["plan", getPlanRoute, `${space}/plans/${planId}`, { ...params, planId }],
    ["lines", linesRoute, `${space}/reports/lines?period=${period}`, params],
    ["member-matrix", matrixRoute, `${space}/reports/member-matrix?period=${period}`, params],
    ["fund-contributions", fundRoute, `${space}/reports/fund-contributions?period=${period}`, params],
    ["trend", trendRoute, `${space}/reports/trend?endPeriod=${period}&periods=6`, params],
  ] as const satisfies readonly (readonly [string, RouteHandler, string, Record<string, string>])[];
};

/** Each read's SQL statement count, the session's own included. */
const statementCounts = async (chain: { h: Household; planId: string }, period: string) => {
  const counts: Record<string, number> = {};
  for (const [name, handler, path, params] of readsOf(chain, period)) {
    const { result, statements } = await statementsDuring(() =>
      call(handler, "GET", path, { user: chain.h.ana, params }),
    );
    expect(result.status).toBe(200);
    counts[name] = statements.length;
  }
  return counts;
};

describe("a plan's carry-over chain is read in one batch, whatever its length (API efficiency)", () => {
  it("reads the plan and its reports in as many statements after seven months of copies as after three", async () => {
    const short = await statementCounts(await chainOf(MONTHS.slice(0, 3)), "2026-07");
    const long = await statementCounts(await chainOf(MONTHS), "2026-11");
    expect(long).toEqual(short);
    // Measured 2026-11-09 with seven plans, before: plan 61, lines 64, member-matrix 67, fund-contributions 65, trend 68.
    expect(long).toEqual({
      plan: 14,
      lines: 15,
      "member-matrix": 16,
      "fund-contributions": 17,
      trend: 15,
    });
  });

  it("carries Home's and Free's leftovers through every closed plan of the chain", async () => {
    const chain = await chainOf(MONTHS.slice(0, 4));
    const response = await call(
      getPlanRoute,
      "GET",
      `/api/v1/spaces/${chain.h.spaceId}/plans/${chain.planId}`,
      {
        user: chain.h.ana,
        params: { spaceId: chain.h.spaceId, planId: chain.planId },
      },
    );
    const { lines } = (await response.json()) as {
      lines: { name: string; carryOver: { amount: string }; available: { amount: string } }[];
    };
    const figures = Object.fromEntries(lines.map((l) => [l.name, [l.carryOver.amount, l.available.amount]]));
    // Home plans 1,470,000 a month and spends 500,000, 510,000 and 520,000 in May … July, so 2,880,000 is carried into
    // August, which spends 530,000. Free spends nothing: 3 × 730,000 carried. RESET lines carry nothing.
    expect(figures).toEqual({
      Rent: ["0", "120000000"],
      Home: ["288000000", "382000000"],
      Savings: ["0", "60000000"],
      Free: ["219000000", "292000000"],
    });
  });
});
