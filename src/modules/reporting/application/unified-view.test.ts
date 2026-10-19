import { describe, expect, it } from "vitest";
import type { BudgetPlanId } from "@/modules/budgeting/application";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { ANA_PLACES, personalWorld, place } from "../../../../tests/support/personal-world";
import { createGetUnifiedPersonalView } from "./get-unified-personal-view";

const pesos = (n: number) => BigInt(n) * 100n;
const NOVEMBER = "2026-11-01";

/** HU-E7-04 Background as the ledger sums Ana's rows: her personal Market and Dinner, her shares in Household. */
const background = () => {
  const w = personalWorld();
  w.sums.consumption[NOVEMBER] = [
    { spaceId: "space-ana", categoryId: "cat-ana-groceries", amount: pesos(85_000) },
    { spaceId: "space-ana", categoryId: "cat-ana-restaurants", amount: pesos(60_000) },
    { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(950_000) },
    { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(480_000) },
  ];
  w.sums.paidOut[NOVEMBER] = {
    payments: pesos(2_145_000),
    paymentsOutsideTheApp: 0n,
    fundContributions: pesos(480_000),
    contributionsOutsideTheApp: 0n,
  };
  return w;
};
const read = (w: ReturnType<typeof personalWorld>, period = "2026-11", userId = "u-ana") =>
  createGetUnifiedPersonalView(w.deps)({ userId, period });

describe("unified personal view (HU-E7-04)", () => {
  it("totals Ana's consumption across spaces, Groceries of both under the key groceries (@critical)", async () => {
    const view = unwrap(await read(background()));
    expect(view.consumption.total).toBe(pesos(1_575_000));
    // Ruling P76: Household's "Mercado" takes the name Ana's personal space gives the key.
    expect(view.consumption.groups).toEqual([
      { key: "groceries", name: "Groceries", space: null, category: null, amount: pesos(1_035_000) },
      { key: "rent", name: "Rent", space: null, category: null, amount: pesos(480_000) },
      { key: "restaurants", name: "Restaurants", space: null, category: null, amount: pesos(60_000) },
    ]);
  });

  it("reports cash out apart from consumption, the 480,000 COP fund contribution included (@critical)", async () => {
    const view = unwrap(await read(background()));
    expect(view.cashOut).toEqual({
      total: pesos(2_625_000),
      payments: pesos(2_145_000),
      fundContributions: pesos(480_000),
      savingsTransfers: 0n,
      outsideTheApp: 0n,
    });
    expect(view.consumption.total).toBe(pesos(1_575_000));
  });

  it("adds the transfers into Ana's own savings accounts and names what left outside the app", async () => {
    const w = background();
    w.transfers[NOVEMBER] = [
      { accountId: "acc-savings", amount: pesos(200_000) },
      { accountId: "acc-juan-savings", amount: pesos(50_000) },
      // Dated after the period's last day: not Ana's November cash out.
      { accountId: "acc-savings", amount: pesos(70_000), on: "2026-12-01" as LocalDate },
    ];
    w.sums.paidOut[NOVEMBER] = {
      payments: pesos(2_145_000),
      paymentsOutsideTheApp: pesos(30_000),
      fundContributions: pesos(480_000),
      contributionsOutsideTheApp: pesos(20_000),
    };
    expect(unwrap(await read(w)).cashOut).toMatchObject({
      total: pesos(2_825_000),
      savingsTransfers: pesos(200_000),
      outsideTheApp: pesos(50_000),
    });
    expect(w.transfersAsked).toEqual([{ accountIds: ["acc-savings"], from: "2026-11-01", to: "2026-11-30" }]);
  });

  it("asks only about Ana's own member rows, within her personal period, whatever Household's policy", async () => {
    const w = background();
    const view = unwrap(await read(w));
    expect(view.period).toEqual({ start: "2026-11-01", end: "2026-11-30", label: "2026-11" });
    expect(w.sums.asked).toEqual([
      { memberIds: ["member-ana-personal", "member-ana"], from: "2026-11-01", to: "2026-11-30" },
      { memberIds: ["member-ana-personal", "member-ana"], from: "2026-11-01", to: "2026-11-30" },
    ]);
  });

  it("uses the stored period of a plan of her personal space (D10)", async () => {
    const w = background();
    await w.plans.add({
      id: "plan-ana" as BudgetPlanId,
      spaceId: "space-ana",
      period: { start: "2026-11-05" as LocalDate, end: "2026-12-04" as LocalDate, label: "2026-11" },
      status: "ACTIVE",
      createdFrom: null,
      version: 1,
      createdBy: "u-ana",
      createdAt: new Date("2026-10-14T12:00:00Z"),
    });
    expect(unwrap(await read(w)).period).toMatchObject({ start: "2026-11-05", end: "2026-12-04" });
    // Every question, the sums' and the transfers', covers the stored period and not the policy's.
    const range = { from: "2026-11-05", to: "2026-12-04" };
    expect(w.sums.asked.map(({ from, to }) => ({ from, to }))).toEqual([range, range]);
    expect(w.transfersAsked.map(({ from, to }) => ({ from, to }))).toEqual([range]);
  });

  it("keeps custom categories apart under their space and category", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      { spaceId: "space-ana", categoryId: "cat-ana-pets", amount: pesos(40_000) },
      { spaceId: "space-household", categoryId: "cat-pets", amount: pesos(30_000) },
    ];
    expect(unwrap(await read(w)).consumption.groups).toEqual([
      {
        key: null,
        name: "Pets",
        space: { id: "space-ana", name: "Personal" },
        category: { id: "cat-ana-pets", name: "Pets" },
        amount: pesos(40_000),
      },
      {
        key: null,
        name: "Pets",
        space: { id: "space-household", name: "Household" },
        category: { id: "cat-pets", name: "Pets" },
        amount: pesos(30_000),
      },
    ]);
  });

  it("counts a subcategory's consumption in its category, under its key or its custom row (HU-E3-04)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      { spaceId: "space-ana", categoryId: "cat-ana-verduras", amount: pesos(20_000) },
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(100_000) },
      { spaceId: "space-household", categoryId: "cat-vet", amount: pesos(25_000) },
    ];
    expect(
      unwrap(await read(w)).consumption.groups.map((g) => [g.key, g.name, g.category?.id ?? null, g.amount]),
    ).toEqual([
      ["groceries", "Groceries", null, pesos(120_000)],
      [null, "Pets", "cat-pets", pesos(25_000)],
    ]);
  });

  it("rolls a seeded category moved under another into the parent, whatever key it keeps (HU-E3-04)", async () => {
    const w = personalWorld();
    w.sums.consumption[NOVEMBER] = [
      { spaceId: "space-household", categoryId: "cat-groceries", amount: pesos(100_000) },
      // Household's seeded Rent was moved under Groceries: it keeps the key "rent" but counts in its parent.
      { spaceId: "space-household", categoryId: "cat-rent", amount: pesos(30_000) },
    ];
    const catalog = {
      listCategories: async (spaceId: string) =>
        (await w.deps.catalog.listCategories(spaceId)).map((c) =>
          c.id === "cat-rent" ? { ...c, parentCategoryId: "cat-groceries" } : c,
        ),
    };
    const view = unwrap(
      await createGetUnifiedPersonalView({ ...w.deps, catalog })({ userId: "u-ana", period: "2026-11" }),
    );
    expect(view.consumption.groups.map((g) => [g.key, g.name, g.amount])).toEqual([
      ["groceries", "Groceries", pesos(130_000)],
    ]);
    expect(view.consumption.total).toBe(pesos(130_000));
  });

  it("leaves spaces in another currency out of every sum and names them once (D6)", async () => {
    const trip = place("space-trip", "member-ana-trip", "Trip", { currency: "USD" });
    const again = place("space-trip", "member-ana-trip-2", "Trip", { currency: "USD" });
    const w = personalWorld([...ANA_PLACES, trip, again]);
    const view = unwrap(await read(w));
    expect(view.otherCurrencySpaces).toEqual([{ spaceId: "space-trip", name: "Trip", currency: "USD" }]);
    // Neither the consumption nor the cash out question names the USD rows.
    expect(w.sums.asked.map((a) => a.memberIds)).toEqual([
      ["member-ana-personal", "member-ana"],
      ["member-ana-personal", "member-ana"],
    ]);
    expect(view.currency).toBe("COP");
  });

  it("refuses a label her personal policy does not name", async () => {
    expect(codeOf(await read(background(), "2026-11 H1"))).toBe("InvalidPeriodLabel");
    expect(codeOf(await read(background(), "2026-11", "u-nobody"))).toBe("SpaceNotFound");
  });
});
