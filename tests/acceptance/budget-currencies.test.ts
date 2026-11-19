import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as activateRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/activate/route";
import { PUT as putCapacitiesRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route";
import { PUT as putAllocationRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/allocation/route";
import { PATCH as patchLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route";
import { POST as postLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp } from "../support/app";
import { newPlan, plansPath, type PlanDto } from "../support/budgeting";
import { cop, household } from "../support/ledger";

const usd = (dollars: number) => ({ amount: String(dollars * 100), currency: "USD" });

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface CurrencyPlanDto extends PlanDto {
  lines: (PlanDto["lines"][number] & {
    budgets: { planned: unknown; budgeted: boolean; allocation: { error: string | null } }[];
  })[];
  currencies: { totalCapacity: unknown; planned: unknown; unallocated: unknown }[];
}

/**
 * Ruling P342 (S7, owner: "Líneas por moneda", "Misma regla, por moneda"), the approved boards of
 * docs/design/2026-11-18-plan-per-currency: Ana 1.600.000 COP, Juan 2.400.000 COP and 100 USD; Arriendo 3.700.000
 * COP and Salidas 300.000 COP y 100 USD.
 */
const december = async () => {
  const h = await household();
  const { id: planId } = await newPlan(h.ana, h.spaceId, "2026-12");
  const params = { spaceId: h.spaceId, planId };
  const capacities = (entries: { memberId: string; amount: unknown }[]) =>
    call(putCapacitiesRoute, "PUT", plansPath(h.spaceId, `/${planId}/capacities`), {
      user: h.ana,
      params,
      body: { capacities: entries },
    });
  const post = (body: unknown) =>
    call(postLineRoute, "POST", plansPath(h.spaceId, `/${planId}/lines`), { user: h.ana, params, body });
  const patch = (lineId: string, body: unknown) =>
    call(patchLineRoute, "PATCH", plansPath(h.spaceId, `/${planId}/lines/${lineId}`), {
      user: h.ana,
      params: { ...params, lineId },
      body,
    });
  const allocate = (lineId: string, body: unknown) =>
    call(putAllocationRoute, "PUT", plansPath(h.spaceId, `/${planId}/lines/${lineId}/allocation`), {
      user: h.ana,
      params: { ...params, lineId },
      body,
    });
  const activate = () =>
    call(activateRoute, "POST", plansPath(h.spaceId, `/${planId}/activate`), { user: h.ana, params });
  expect(
    (
      await capacities([
        { memberId: h.ana.memberId, amount: cop(1_600_000) },
        { memberId: h.juan.memberId, amount: cop(2_400_000) },
        { memberId: h.juan.memberId, amount: usd(100) },
      ])
    ).status,
  ).toBe(200);
  expect((await post({ name: "Arriendo", plannedAmount: cop(3_700_000) })).status).toBe(201);
  return { h, planId, capacities, post, patch, allocate, activate };
};

describe("a plan line per currency (ruling P342, S7)", () => {
  it("plans Salidas in COP and USD and answers Por repartir per currency, the space's scalars as before", async () => {
    const { post } = await december();
    const response = await post({ name: "Salidas", budgets: [cop(300_000), usd(100)] });
    expect(response.status).toBe(201);
    const plan = (await response.json()) as CurrencyPlanDto;
    const salidas = plan.lines.find((l) => l.name === "Salidas")!;
    expect(salidas.plannedAmount).toEqual(cop(300_000));
    expect(salidas.budgets.map((b) => [b.planned, b.budgeted])).toEqual([
      [cop(300_000), true],
      [usd(100), true],
    ]);
    expect(plan.unallocated).toEqual(cop(0));
    expect(plan.currencies.map((c) => [c.totalCapacity, c.planned, c.unallocated])).toEqual([
      [cop(4_000_000), cop(4_000_000), cop(0)],
      [usd(100), usd(100), usd(0)],
    ]);
  });

  it("refuses a USD budget beyond the USD contributions, and a body with both or neither way to plan", async () => {
    const { post } = await december();
    const refused = await post({ name: "Salidas", budgets: [cop(300_000), usd(101)] });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "PlanExceedsCapacity" });
    expect(await problemOf(await post({ name: "Viaje" }))).toEqual([422, "ValidationFailed"]);
    expect(await problemOf(await post({ name: "Viaje", plannedAmount: cop(1), budgets: [cop(1)] }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect(await problemOf(await post({ name: "Viaje", budgets: [usd(1), usd(2)] }))).toEqual([
      422,
      "InvalidPlannedAmount",
    ]);
  });

  it("allocates FIXED per currency, flags a currency that does not add up, and activates once every currency holds", async () => {
    const { h, post, allocate, activate } = await december();
    const plan = (await (
      await post({ name: "Salidas", budgets: [cop(300_000), usd(100)] })
    ).json()) as CurrencyPlanDto;
    const lineId = plan.lines.find((l) => l.name === "Salidas")!.id;
    const fixed = (dollars: number) =>
      allocate(lineId, {
        rule: "FIXED",
        members: [
          { memberId: h.ana.memberId, amount: cop(100_000) },
          { memberId: h.juan.memberId, amount: cop(200_000) },
          { memberId: h.juan.memberId, amount: usd(dollars) },
        ],
      });
    expect(await problemOf(await fixed(90))).toEqual([422, "InvalidAllocation"]);
    const allocated = (await (await fixed(100)).json()) as CurrencyPlanDto;
    expect(allocated.lines.find((l) => l.id === lineId)!.budgets.map((b) => b.allocation.error)).toEqual([
      null,
      null,
    ]);
    expect((await activate()).status).toBe(200);
  });

  it("refuses activation while the USD contributions fall below the USD budgets", async () => {
    const { h, post, capacities, activate } = await december();
    expect((await post({ name: "Salidas", budgets: [cop(300_000), usd(100)] })).status).toBe(201);
    expect((await capacities([{ memberId: h.juan.memberId, amount: usd(99) }])).status).toBe(200);
    const refused = await activate();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "PlanExceedsCapacity" });
  });

  it("replaces a line's budgets as a set, or adds one currency with plannedAmount", async () => {
    const { post, patch } = await december();
    const plan = (await (
      await post({ name: "Salidas", plannedAmount: cop(300_000) })
    ).json()) as CurrencyPlanDto;
    const lineId = plan.lines.find((l) => l.name === "Salidas")!.id;
    const added = (await (await patch(lineId, { plannedAmount: usd(50) })).json()) as CurrencyPlanDto;
    expect(added.lines.find((l) => l.id === lineId)!.budgets.map((b) => b.planned)).toEqual([
      cop(300_000),
      usd(50),
    ]);
    const onlyUsd = (await (await patch(lineId, { budgets: [usd(80)] })).json()) as CurrencyPlanDto;
    const line = onlyUsd.lines.find((l) => l.id === lineId)!;
    expect(line.budgets.map((b) => b.planned)).toEqual([usd(80)]);
    // Breaking for a client reading only the scalar: a line without a COP budget reports 0 COP planned.
    expect(line.plannedAmount).toEqual(cop(0));
  });
});
