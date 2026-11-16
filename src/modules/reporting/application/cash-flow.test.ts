import { describe, expect, it } from "vitest";
import type { ScheduledMovement } from "@/modules/ledger/application";
import { domainError, err, ExchangeRate, FixedClock, ok, type LocalDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { createGetCashFlow, type CashFlowDeps } from "./get-cash-flow";

const pesos = (n: number) => BigInt(n) * 100n;
const day = (iso: string) => iso as LocalDate;

const salary: ScheduledMovement = {
  recurrenceId: "rec-salary",
  occurrenceId: null,
  type: "INCOME",
  description: "Salary",
  date: day("2026-10-30"),
  status: "SCHEDULED",
  estimated: false,
  amount: pesos(3_000_000),
  currency: "COP",
  debitAccountId: null,
  creditAccountId: "acc-bancolombia",
};
const rent: ScheduledMovement = {
  ...salary,
  recurrenceId: "rec-rent",
  type: "EXPENSE",
  description: "Rent",
  date: day("2026-11-01"),
  amount: pesos(1_200_000),
  debitAccountId: "acc-bancolombia",
  creditAccountId: null,
};

const world = () => {
  const asked: [string, string][] = [];
  const deps: CashFlowDeps = {
    // 2026-10-29 at noon in Bogotá.
    clock: new FixedClock(new Date("2026-10-29T17:00:00Z")),
    userTimeZones: { timeZoneOf: async () => "America/Bogota" },
    spacesOf: async () => [
      { spaceId: "space-ana", name: "Personal" },
      { spaceId: "space-household", name: "Household" },
    ],
    scheduled: async ({ spaceId, through }) => {
      asked.push([spaceId, through]);
      return spaceId === "space-ana" ? [salary] : [rent];
    },
    ownAccountsOf: async () => ({
      currency: "COP",
      available: pesos(100_000),
      accounts: [{ id: "acc-bancolombia", counted: true }],
    }),
  };
  return { deps, asked };
};

describe("GetCashFlow (#150, ruling P238 of M6c)", () => {
  it("reads each of the caller's spaces once through the window's last day, from today in their zone", async () => {
    const { deps, asked } = world();
    const view = unwrap(await createGetCashFlow(deps)({ userId: "u-ana", days: 30 }));
    expect(asked).toEqual([
      ["space-ana", "2026-11-27"],
      ["space-household", "2026-11-27"],
    ]);
    expect(view).toMatchObject({
      currency: "COP",
      from: "2026-10-29",
      through: "2026-11-27",
      days: 30,
      opening: pesos(100_000),
    });
    expect(view.dates.map((d) => [d.date, d.movements[0]!.space, d.balanceAfter])).toEqual([
      ["2026-10-30", { id: "space-ana", name: "Personal" }, pesos(3_100_000)],
      ["2026-11-01", { id: "space-household", name: "Household" }, pesos(1_900_000)],
    ]);
  });

  it("reaches 59 days past today for a 60-day window", async () => {
    const { deps, asked } = world();
    unwrap(await createGetCashFlow(deps)({ userId: "u-ana", days: 60 }));
    expect(asked[0]).toEqual(["space-ana", "2026-12-27"]);
  });

  it("starts on the caller's local date at the start and end of a Bogotá day, never the UTC one (ruling P246 of M6c)", async () => {
    const { deps } = world();
    const at = (iso: string) =>
      createGetCashFlow({ ...deps, clock: new FixedClock(new Date(iso)) })({ userId: "u-ana", days: 30 });
    // 23:59:59 on 2026-10-28 in Bogotá is already 2026-10-29 in UTC; 00:00:00 on 2026-10-29 in Bogotá is 05:00 UTC.
    const late = unwrap(await at("2026-10-29T04:59:59Z"));
    const early = unwrap(await at("2026-10-29T05:00:00Z"));
    expect([late.from, late.through, early.from, early.through]).toEqual([
      "2026-10-28",
      "2026-11-26",
      "2026-10-29",
      "2026-11-27",
    ]);
  });
});

describe("GetCashFlow in the display currency (D29, slice MC4, ending ruling P240's other currencies apart)", () => {
  const ratesOf = (table: Record<string, string>, asked: LocalDate[] = []) => ({
    datedRateOn: async (base: string, quote: string, on: LocalDate) => {
      asked.push(on);
      const value = table[`${base}>${quote}`];
      return value === undefined
        ? err(domainError("NoExchangeRate", { base, quote }))
        : ok({ rate: unwrap(ExchangeRate.of(base, quote, value)), date: day("2026-10-28"), stale: false });
    },
  });
  const subscription: ScheduledMovement = {
    ...rent,
    recurrenceId: "rec-netflix",
    description: "Netflix",
    date: day("2026-11-05"),
    amount: 1_000n,
    currency: "USD",
  };
  const withTrip = () => {
    const { deps } = world();
    return {
      ...deps,
      spacesOf: async () => [{ spaceId: "space-trip", name: "Trip" }],
      scheduled: async () => [subscription],
    } satisfies CashFlowDeps;
  };

  it("converts a movement in another currency at its day's rate, today's for one still ahead", async () => {
    const asked: LocalDate[] = [];
    const deps = { ...withTrip(), rates: ratesOf({ "USD>COP": "4100" }, asked) };
    const view = unwrap(await createGetCashFlow(deps)({ userId: "u-ana", days: 30 }));
    // US$ 10 at 4.100 leaves $ 41.000 of the $ 100.000 available.
    expect(view.dates.map((d) => [d.date, d.movements[0]!.effect, d.balanceAfter])).toEqual([
      ["2026-11-05", -pesos(41_000), pesos(59_000)],
    ]);
    expect(view.otherCurrencySpaces).toEqual([]);
    expect(asked).toEqual(["2026-10-29"]);
  });

  it("lists a movement with no rate apart, never at 1:1", async () => {
    const view = unwrap(
      await createGetCashFlow({ ...withTrip(), rates: ratesOf({}) })({ userId: "u-ana", days: 30 }),
    );
    expect(view.dates).toEqual([]);
    expect(view.otherCurrencySpaces).toEqual([{ spaceId: "space-trip", name: "Trip", currency: "USD" }]);
  });

  it("projects in the person's display currency, the opening at today's rate", async () => {
    const deps = {
      ...withTrip(),
      displayCurrencyOf: async () => "USD",
      rates: ratesOf({ "COP>USD": "0.00025" }),
    };
    const view = unwrap(await createGetCashFlow(deps)({ userId: "u-ana", days: 30 }));
    // $ 100.000 at 0,00025 is US$ 25,00; the US$ 10 subscription is already in USD.
    expect([view.currency, view.opening, view.totals.closing]).toEqual(["USD", 2_500n, 1_500n]);
  });

  it("says the display currency is unavailable, and stays in the personal space's, when today has no rate for it", async () => {
    const deps = {
      ...withTrip(),
      displayCurrencyOf: async () => "USD",
      rates: ratesOf({ "COP>USD": "0.00025" }),
    };
    const view = unwrap(await createGetCashFlow(deps)({ userId: "u-ana", days: 30 }));
    expect([view.currency, view.displayCurrencyUnavailable]).toEqual(["USD", false]);
    const none = unwrap(
      await createGetCashFlow({ ...withTrip(), displayCurrencyOf: async () => "GBP", rates: ratesOf({}) })({
        userId: "u-ana",
        days: 30,
      }),
    );
    expect([none.currency, none.opening, none.displayCurrencyUnavailable]).toEqual([
      "COP",
      pesos(100_000),
      true,
    ]);
  });
});
