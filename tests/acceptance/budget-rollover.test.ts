import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { startTestApp } from "../support/app";
import {
  activatePlan,
  closePlan,
  addLine,
  copyPlan,
  lineNamed,
  patchLine,
  planOf,
  putCategories,
  referencePlan,
  type PlanDto,
} from "../support/budgeting";
import { cop, post } from "../support/ledger";

/** 2026-12-02 at noon in Bogota: 2026-11 has ended, so its plan can be closed (HU-E6-07). */
const NOW = new Date("2026-12-02T17:00:00Z");

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(NOW) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * The Given steps of HU-E6-09's Scenario Outline: the reference plan for 2026-11 with Groceries mapped to Home and Home's rollover `mode`; Ana
 * spends `pesos` in Groceries on 2026-11-10; the 2026-11 plan is then left as it is, activated, or activated and closed
 * (`november`, CLOSED by default as in the outline's Given step); then 2026-12 is copied from it, before any December
 * spending (HU-E6-09, ruling P243 of M6c).
 */
const rolledInto = async (
  mode: string,
  pesos: number,
  november: "DRAFT" | "ACTIVE" | "CLOSED" = "CLOSED",
) => {
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
  if (november !== "DRAFT") {
    const activated = await activatePlan(h.ana, h.spaceId, planId);
    expect(activated.status).toBe(200);
    if (november === "CLOSED") {
      const version = ((await activated.json()) as PlanDto).version;
      expect((await closePlan(h.ana, h.spaceId, planId, version)).status).toBe(200);
    }
  }
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
      const november = await planOf(h.ana, h.spaceId, planId);
      expect(november.status).toBe("CLOSED");
      expect(lineNamed(november, "Home").available).toEqual(cop(nov));
      expect(lineNamed(december, "Home")).toMatchObject({
        carryOver: cop(dec - 1_470_000),
        available: cop(dec),
        // ruling P243: a carrying line names the closed plan it carries from; RESET names none
        carryOverFrom: mode === "RESET" ? null : { planId, period: november.period, closed: true },
      });
      expect(lineNamed(await planOf(h.juan, h.spaceId, december.id), "Home")).toMatchObject({
        carryOver: cop(dec - 1_470_000),
        available: cop(dec),
      });
    },
  );

  it.each(["DRAFT", "ACTIVE"] as const)(
    "carries nothing from a November that is only %s, and says it waits for that plan (ruling P243 of M6c)",
    async (status) => {
      const { h, planId, december } = await rolledInto("ROLLOVER", 1_270_000, status);
      const november = await planOf(h.ana, h.spaceId, planId);
      expect(november.status).toBe(status);
      expect(lineNamed(december, "Home")).toMatchObject({
        carryOver: cop(0),
        available: cop(1_470_000),
        carryOverFrom: { planId, period: november.period, closed: false },
      });
      expect(lineNamed(await planOf(h.juan, h.spaceId, december.id), "Home")).toMatchObject({
        carryOver: cop(0),
        carryOverFrom: { planId, closed: false },
      });
    },
  );

  it("carries the 200,000 COP once the waiting November is closed: derived on read, nothing was stored (ruling P230)", async () => {
    const { h, planId, december } = await rolledInto("ROLLOVER", 1_270_000, "ACTIVE");
    expect(lineNamed(december, "Home").carryOver).toEqual(cop(0));
    const november = await planOf(h.ana, h.spaceId, planId);
    expect((await closePlan(h.ana, h.spaceId, planId, november.version)).status).toBe(200);
    expect(lineNamed(await planOf(h.ana, h.spaceId, december.id), "Home")).toMatchObject({
      carryOver: cop(200_000),
      available: cop(1_670_000),
      carryOverFrom: { planId, closed: true },
    });
  });

  it("carries nothing into a line December added by hand, even with ROLLOVER on and November CLOSED (the competitor's pitfall)", async () => {
    const { h, december } = await rolledInto("ROLLOVER", 1_270_000);
    // December plans its whole capacity, so Free gives up 100,000 COP to make room for the new line.
    expect(
      (await patchLine(h.ana, h.spaceId, december.id, lineNamed(december, "Free").id, { pesos: 630_000 }))
        .status,
    ).toBe(200);
    const added = await addLine(h.ana, h.spaceId, december.id, {
      name: "Pets",
      pesos: 100_000,
      funding: "DIRECT",
      rolloverMode: "ROLLOVER",
    });
    expect(lineNamed(added, "Pets")).toMatchObject({ carryOver: cop(0), carryOverFrom: null });
    expect(lineNamed(added, "Home")).toMatchObject({ carryOver: cop(200_000) });
  });

  it("never counts the carry-over against the capacity: December plans exactly its 4,000,000 COP while Home carries 200,000, and it still activates (ruling P229)", async () => {
    const { h, december } = await rolledInto("ROLLOVER", 1_270_000);
    const home = lineNamed(december, "Home");
    expect(home.carryOver).toEqual(cop(200_000));
    // December plans exactly its capacity (4,000,000 COP) while Home carries 200,000: unallocated stays 0.
    expect(december.unallocated).toEqual(cop(0));
    expect(december.planned).toEqual(december.totalCapacity);
    expect((await activatePlan(h.ana, h.spaceId, december.id)).status).toBe(200);
  });

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
      carryOverFrom: null,
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
