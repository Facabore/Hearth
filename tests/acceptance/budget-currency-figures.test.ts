import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, startTestApp } from "../support/app";
import {
  activatePlan,
  closePlan,
  copyPlan,
  newPlan,
  planOf,
  plansPath,
  putAllocation,
  putCategories,
  type PlanDto,
} from "../support/budgeting";
import { PUT as putCapacitiesRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route";
import { POST as postLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route";
import { cop, household, post, type Household, type MoneyDto } from "../support/ledger";

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

const usd = (dollars: number): MoneyDto => ({ amount: String(dollars * 100), currency: "USD" });
const eur = (euros: number): MoneyDto => ({ amount: String(euros * 100), currency: "EUR" });

/** A line's figures in one currency, as P342 (S7) answers them. */
interface BudgetDto {
  planned: MoneyDto;
  budgeted: boolean;
  allocation: {
    members: { memberId: string; amount: MoneyDto | null; assigned: MoneyDto | null }[];
    error: string | null;
  };
  spent: MoneyDto;
  carryOver: MoneyDto;
  available: MoneyDto;
}
type CurrencyLine = PlanDto["lines"][number] & { budgets: BudgetDto[] };
interface CurrencyPlan extends Omit<PlanDto, "lines"> {
  lines: CurrencyLine[];
  currencies: { capacities: { memberId: string; amount: MoneyDto }[]; totalCapacity: MoneyDto }[];
}

const salidasOf = (plan: CurrencyPlan) => plan.lines.find((l) => l.name === "Salidas")!;
const readPlan = async (h: Household, planId: string) =>
  (await planOf(h.ana, h.spaceId, planId)) as unknown as CurrencyPlan;

/**
 * Ruling P342 (S7, "Líneas por moneda", "Misma regla, por moneda"): Household's November plan. Ana puts in 1.600.000
 * COP and 100 USD, Juan 2.400.000 COP and 100 USD; Arriendo plans 3.700.000 COP; Salidas, with Groceries mapped to it
 * and `rolloverMode`, plans 300.000 COP and 100 USD. Nothing is ever converted.
 */
const november = async (rolloverMode = "RESET") => {
  const h = await household();
  const { id: planId } = await newPlan(h.ana, h.spaceId, "2026-11");
  const params = { spaceId: h.spaceId, planId };
  const capacities = await call(putCapacitiesRoute, "PUT", plansPath(h.spaceId, `/${planId}/capacities`), {
    user: h.ana,
    params,
    body: {
      capacities: [
        { memberId: h.ana.memberId, amount: cop(1_600_000) },
        { memberId: h.ana.memberId, amount: usd(100) },
        { memberId: h.juan.memberId, amount: cop(2_400_000) },
        { memberId: h.juan.memberId, amount: usd(100) },
      ],
    },
  });
  expect(capacities.status).toBe(200);
  const line = (body: unknown) =>
    call(postLineRoute, "POST", plansPath(h.spaceId, `/${planId}/lines`), { user: h.ana, params, body });
  expect((await line({ name: "Arriendo", plannedAmount: cop(3_700_000) })).status).toBe(201);
  const added = await line({ name: "Salidas", budgets: [cop(300_000), usd(100)], rolloverMode });
  expect(added.status).toBe(201);
  const salidas = salidasOf((await added.json()) as CurrencyPlan).id;
  expect((await putCategories(h.ana, h.spaceId, planId, salidas, [h.groceries])).status).toBe(200);
  /** Ana pays `amount` for Groceries from her COP account, which moved `accountAmount`, shared with Juan. */
  const pays = async (amount: MoneyDto, accountAmount?: MoneyDto) => {
    const response = await post(recordExpense, h.ana, "expenses", {
      description: "Salida",
      date: "2026-11-10",
      categoryId: h.groceries,
      amount,
      payments: [
        {
          memberId: h.ana.memberId,
          accountId: h.ana.account,
          amount,
          ...(accountAmount === undefined ? {} : { accountAmount }),
        },
      ],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(response.status).toBe(201);
  };
  return { h, planId, salidas, pays };
};

const assignedOf = (line: CurrencyLine) =>
  line.budgets.map((b) => [b.planned.currency, b.allocation.members.map((m) => m.assigned)]);

describe("the line's rule per currency (ruling P342, S7: 'Misma regla, por moneda')", () => {
  it("PROPORTIONAL follows each member's contribution in that currency", async () => {
    const { h, planId } = await november();
    expect(assignedOf(salidasOf(await readPlan(h, planId)))).toEqual([
      ["COP", [cop(120_000), cop(180_000)]],
      ["USD", [usd(50), usd(50)]],
    ]);
  });

  it("PERCENT applies the same share to every currency", async () => {
    const { h, planId, salidas } = await november();
    const response = await putAllocation(h.ana, h.spaceId, planId, salidas, {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "30.00" },
        { memberId: h.juan.memberId, percent: "70.00" },
      ],
    });
    expect(response.status).toBe(200);
    expect(assignedOf(salidasOf((await response.json()) as CurrencyPlan))).toEqual([
      ["COP", [cop(90_000), cop(210_000)]],
      ["USD", [usd(30), usd(70)]],
    ]);
  });
});

describe("spending per currency (ruling P342, S7)", () => {
  it("counts a USD expense paid from a COP account only in USD, and never by what the account moved", async () => {
    const { h, planId, pays } = await november();
    await pays(usd(45), cop(184_500));
    const salidas = salidasOf(await readPlan(h, planId));
    expect(salidas.budgets.map((b) => [b.planned, b.spent, b.available])).toEqual([
      [cop(300_000), cop(0), cop(300_000)],
      [usd(100), usd(45), usd(55)],
    ]);
    expect([salidas.spent, salidas.available]).toEqual([cop(0), cop(300_000)]);
  });

  it("reports an EUR expense on a line without an EUR budget as spent without a budget, never converted", async () => {
    const { h, planId, pays } = await november();
    await pays(eur(20), cop(90_000));
    const salidas = salidasOf(await readPlan(h, planId));
    expect(salidas.budgets.map((b) => [b.budgeted, b.planned, b.spent, b.available])).toEqual([
      [true, cop(300_000), cop(0), cop(300_000)],
      [true, usd(100), usd(0), usd(100)],
      [false, eur(0), eur(20), eur(-20)],
    ]);
    expect(salidas.allocation.error).toBeNull();
  });
});

describe("carry-over per currency (HU-E6-09, ruling P342, S7)", () => {
  /** November spends 340.000 COP (40.000 over) and 45 USD (55 left) on Salidas, closes, and December is copied. */
  const carriedInto = async (rolloverMode: string) => {
    const { h, planId, pays } = await november(rolloverMode);
    await pays(cop(340_000));
    await pays(usd(45), cop(184_500));
    const activated = await activatePlan(h.ana, h.spaceId, planId);
    expect(activated.status).toBe(200);
    const { version } = (await activated.json()) as PlanDto;
    expect((await closePlan(h.ana, h.spaceId, planId, version)).status).toBe(200);
    const copied = await copyPlan(h.ana, h.spaceId, "2026-12");
    expect(copied.status).toBe(201);
    return salidasOf((await copied.json()) as CurrencyPlan).budgets.map((b) => [b.carryOver, b.available]);
  };

  it("ROLLOVER carries each currency's leftover on its own: 55 USD, and nothing of the COP overspend", async () => {
    expect(await carriedInto("ROLLOVER")).toEqual([
      [cop(0), cop(300_000)],
      [usd(55), usd(155)],
    ]);
  });

  it("ADJUSTED carries each currency's overspend on its own: −40.000 COP, and nothing of the USD left", async () => {
    expect(await carriedInto("ADJUSTED")).toEqual([
      [cop(-40_000), cop(260_000)],
      [usd(0), usd(100)],
    ]);
  });
});

describe("a plan copy per currency (HU-E6-06, ruling P342, S7)", () => {
  it("copies every currency's budgets, contributions and FIXED values", async () => {
    const { h, planId, salidas } = await november();
    const fixed = await putAllocation(h.ana, h.spaceId, planId, salidas, {
      rule: "FIXED",
      members: [
        { memberId: h.ana.memberId, amount: cop(100_000) },
        { memberId: h.juan.memberId, amount: cop(200_000) },
        { memberId: h.juan.memberId, amount: usd(100) },
      ],
    });
    expect(fixed.status).toBe(200);
    const copied = await copyPlan(h.ana, h.spaceId, "2026-12");
    expect(copied.status).toBe(201);
    const december = (await copied.json()) as CurrencyPlan;
    const line = salidasOf(december);
    expect(line.allocation.rule).toBe("FIXED");
    expect(
      line.budgets.map((b) => [b.planned, b.allocation.members.map((m) => m.amount), b.allocation.error]),
    ).toEqual([
      [cop(300_000), [cop(100_000), cop(200_000)], null],
      [usd(100), [null, usd(100)], null],
    ]);
    expect(december.currencies.map((c) => c.capacities.map((m) => m.amount))).toEqual([
      [cop(1_600_000), cop(2_400_000)],
      [usd(100), usd(100)],
    ]);
  });
});
