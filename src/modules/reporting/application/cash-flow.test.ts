import { describe, expect, it } from "vitest";
import type { ScheduledMovement } from "@/modules/ledger/application";
import { FixedClock, type LocalDate } from "@/shared/kernel";
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
