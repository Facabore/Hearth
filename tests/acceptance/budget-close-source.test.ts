import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { startTestApp } from "../support/app";
import {
  activatePlan,
  closePlan,
  copyPlan,
  lineNamed,
  patchLine,
  planOf,
  putCategories,
  referencePlan,
  type PlanDto,
} from "../support/budgeting";
import { cop, post } from "../support/ledger";

/** 2027-01-15 at noon in Bogota: the 2026-11 and 2026-12 periods have ended, 2027-01 has not. */
const NOW = new Date("2027-01-15T17:00:00Z");

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(NOW) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * Ruling P248 (M6c): Home's rollover is `mode`; November (ACTIVE, never closed yet) spent 1,270,000 COP and December,
 * copied from it and ACTIVE too, spent 1,500,000 COP.
 */
const activeNovemberAndDecember = async (mode: string) => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [h.groceries])).status).toBe(200);
  expect((await patchLine(h.ana, h.spaceId, planId, lineId("Home"), { rolloverMode: mode })).status).toBe(
    200,
  );
  const spend = async (date: string, pesos: number) =>
    expect(
      (
        await post(recordExpense, h.ana, "expenses", {
          description: "Market",
          date,
          categoryId: h.groceries,
          amount: cop(pesos),
          accountId: h.ana.account,
        })
      ).status,
    ).toBe(201);
  await spend("2026-11-10", 1_270_000);
  expect((await activatePlan(h.ana, h.spaceId, planId)).status).toBe(200);
  const copied = await copyPlan(h.ana, h.spaceId, "2026-12");
  expect(copied.status).toBe(201);
  const december = (await copied.json()) as PlanDto;
  await spend("2026-12-10", 1_500_000);
  expect((await activatePlan(h.ana, h.spaceId, december.id)).status).toBe(200);
  return { ...ref, december };
};

describe("closing a copy whose source is still open (ruling P248 of M6c)", () => {
  it("answers 409 SourcePlanOpen naming 2026-11, leaves December ACTIVE, and closes it after November, frozen", async () => {
    const { h, planId, december } = await activeNovemberAndDecember("ROLLOVER");
    const refused = await closePlan(h.ana, h.spaceId, december.id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "SourcePlanOpen",
      status: 409,
      sourcePeriod: "2026-11",
    });
    const waiting = await planOf(h.ana, h.spaceId, december.id);
    expect(waiting.status).toBe("ACTIVE");
    expect(lineNamed(waiting, "Home")).toMatchObject({
      carryOver: cop(0),
      available: cop(-30_000),
      carryOverFrom: { planId, closed: false },
    });
    expect((await closePlan(h.ana, h.spaceId, planId)).status).toBe(200);
    const closing = await closePlan(h.ana, h.spaceId, december.id);
    expect(closing.status).toBe(200);
    const frozen = lineNamed((await closing.json()) as PlanDto, "Home");
    expect(frozen).toMatchObject({ carryOver: cop(200_000), available: cop(170_000) });
    expect(lineNamed(await planOf(h.juan, h.spaceId, december.id), "Home")).toEqual(frozen);
  });

  it("closes an all-RESET copy of an open source", async () => {
    const { h, december } = await activeNovemberAndDecember("RESET");
    expect((await closePlan(h.ana, h.spaceId, december.id)).status).toBe(200);
  });
});
