import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { startTestApp } from "../support/app";
import {
  copyPlan,
  lineNamed,
  patchLine,
  planOf,
  putCategories,
  referencePlan,
  type PlanDto,
} from "../support/budgeting";
import { cop, post } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * The Given steps of HU-E6-09's Scenario Outline: the reference plan for 2026-11 with Groceries mapped to Home and Home's rollover `mode`; Ana
 * spends `pesos` in Groceries on 2026-11-10; then 2026-12 is copied from it, before any December spending.
 */
const rolledInto = async (mode: string, pesos: number) => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries])).status).toBe(200);
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { rolloverMode: mode })).status).toBe(
    200,
  );
  const spent = await post(recordExpense, h.ana, "expenses", {
    description: "Market",
    date: "2026-11-10",
    categoryId: h.groceries,
    amount: cop(pesos),
    accountId: h.ana.account,
  });
  expect(spent.status).toBe(201);
  const copied = await copyPlan(h.ana, h.spaceId, "2026-12");
  expect(copied.status).toBe(201);
  return { ...ref, december: (await copied.json()) as PlanDto };
};

describe("rollover modes (HU-E6-09)", () => {
  it.each<[string, number, number, number]>([
    ["RESET", 1_270_000, 200_000, 1_470_000],
    ["RESET", 1_600_000, -130_000, 1_470_000],
    ["ROLLOVER", 1_270_000, 200_000, 1_670_000],
    ["ROLLOVER", 1_600_000, -130_000, 1_470_000],
    ["ADJUSTED", 1_270_000, 200_000, 1_470_000],
    ["ADJUSTED", 1_600_000, -130_000, 1_340_000],
  ])(
    "%s, %i COP spent in 2026-11: November available %i, December available %i (outline)",
    async (mode, spent, nov, dec) => {
      const { h, planId, december } = await rolledInto(mode, spent);
      expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home").available).toEqual(cop(nov));
      expect(lineNamed(december, "Home")).toMatchObject({
        carryOver: cop(dec - 1_470_000),
        available: cop(dec),
      });
      expect(lineNamed(await planOf(h.juan, h.spaceId, december.id), "Home")).toMatchObject({
        carryOver: cop(dec - 1_470_000),
        available: cop(dec),
      });
    },
  );

  it("reports a negative carry-over as a signed amount string in the plan's currency", async () => {
    const { h, december } = await rolledInto("ADJUSTED", 1_600_000);
    const home = lineNamed(await planOf(h.ana, h.spaceId, december.id), "Home");
    expect(home.carryOver).toStrictEqual({ amount: "-13000000", currency: "COP" });
    expect(home.available).toStrictEqual({ amount: "134000000", currency: "COP" });
  });

  it("carries nothing into a plan without a previous plan", async () => {
    const { h, planId, lineId } = await referencePlan();
    expect(
      (await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { rolloverMode: "ROLLOVER" })).status,
    ).toBe(200);
    expect(lineNamed(await planOf(h.ana, h.spaceId, planId), "Home")).toMatchObject({
      carryOver: cop(0),
      available: cop(1_470_000),
    });
  });

  it("carries over through the origin line, not the name: Home renamed House still receives 200,000 COP", async () => {
    const { h, lineId, december } = await rolledInto("ROLLOVER", 1_270_000);
    const renamed = await patchLine(h.ana, h.spaceId, december.id, lineNamed(december, "Home").id, {
      name: "House",
    });
    expect(renamed.status).toBe(200);
    const answer = (await renamed.json()) as PlanDto;
    expect(lineNamed(answer, "House")).toMatchObject({
      originLineId: lineId("Home"),
      carryOver: cop(200_000),
      available: cop(1_670_000),
    });
    // a write's answer reports the carry-over of every line, not only of the one it changed
    expect(Object.fromEntries(answer.lines.map((l) => [l.name, l.carryOver]))).toEqual({
      Rent: cop(0),
      House: cop(200_000),
      Savings: cop(0),
      Free: cop(0),
    });
  });
});
