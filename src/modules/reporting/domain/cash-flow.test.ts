import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { cashFlow, type PlannedMovement } from "./cash-flow";

const pesos = (n: number) => BigInt(n) * 100n;
const day = (iso: string) => iso as LocalDate;

const movement = (overrides: Partial<PlannedMovement>): PlannedMovement => ({
  spaceId: "space-ana",
  spaceName: "Personal",
  recurrenceId: "rec-1",
  occurrenceId: null,
  type: "EXPENSE",
  description: "Internet",
  date: day("2026-11-05"),
  status: "SCHEDULED",
  estimated: false,
  amount: pesos(120_000),
  currency: "COP",
  debitAccountId: "acc-bancolombia",
  creditAccountId: null,
  ...overrides,
});

/** Ana on 2026-10-29: Bancolombia and Nequi count in her available money; her savings and her Visa do not. */
const input = (movements: readonly PlannedMovement[]) => ({
  today: day("2026-10-29"),
  through: day("2026-11-27"),
  currency: "COP",
  opening: pesos(100_000),
  accounts: [
    { id: "acc-bancolombia", counted: true },
    { id: "acc-nequi", counted: true },
    { id: "acc-savings", counted: false },
    { id: "acc-visa", counted: false },
  ],
  movements,
});

describe("the cash flow of the coming days (#150, rulings P239 and P240 of M6c)", () => {
  it("projects the balance after each date from today's available money, with a pending occurrence on today", () => {
    const flow = cashFlow(
      input([
        movement({
          description: "Electricity",
          date: day("2026-10-20"),
          status: "PENDING",
          occurrenceId: "occ-1",
          estimated: true,
          amount: pesos(180_000),
          spaceId: "space-household",
          spaceName: "Household",
        }),
        movement({
          type: "INCOME",
          description: "Salary",
          date: day("2026-10-30"),
          amount: pesos(3_000_000),
          debitAccountId: null,
          creditAccountId: "acc-bancolombia",
        }),
        movement({
          description: "Rent",
          date: day("2026-11-01"),
          amount: pesos(1_200_000),
          spaceId: "space-household",
          spaceName: "Household",
        }),
        movement({
          type: "TRANSFER",
          description: "To savings",
          date: day("2026-11-15"),
          amount: pesos(500_000),
          creditAccountId: "acc-savings",
        }),
        movement({
          type: "TRANSFER",
          description: "To Nequi",
          date: day("2026-11-16"),
          amount: pesos(100_000),
          creditAccountId: "acc-nequi",
        }),
      ]),
    );
    expect(
      flow.dates.map((d) => [d.date, d.movements.map((m) => [m.description, m.effect]), d.balanceAfter]),
    ).toEqual([
      ["2026-10-29", [["Electricity", -pesos(180_000)]], -pesos(80_000)],
      ["2026-10-30", [["Salary", pesos(3_000_000)]], pesos(2_920_000)],
      ["2026-11-01", [["Rent", -pesos(1_200_000)]], pesos(1_720_000)],
      ["2026-11-15", [["To savings", -pesos(500_000)]], pesos(1_220_000)],
      ["2026-11-16", [["To Nequi", 0n]], pesos(1_220_000)],
    ]);
    expect(flow.dates[0]!.movements[0]).toMatchObject({
      date: "2026-10-20",
      status: "PENDING",
      estimated: true,
    });
    expect(flow.totals).toEqual({
      incoming: pesos(3_000_000),
      outgoing: pesos(1_880_000),
      closing: pesos(1_220_000),
    });
    expect(flow.lowest).toEqual({ date: "2026-10-29", balance: -pesos(80_000) });
  });

  it("leaves out what moves no account of the caller's, and names a space in another currency once", () => {
    const flow = cashFlow(
      input([
        movement({ description: "Juan's phone", debitAccountId: "acc-davivienda" }),
        movement({ description: "Fund rent", debitAccountId: "acc-household-fund" }),
        movement({ description: "Trip", currency: "USD", spaceId: "space-trip", spaceName: "Trip" }),
        movement({
          description: "Trip again",
          currency: "USD",
          spaceId: "space-trip",
          spaceName: "Trip",
          date: day("2026-11-06"),
        }),
        movement({ description: "Later", date: day("2026-11-28") }),
      ]),
    );
    expect(flow.dates).toEqual([]);
    expect(flow.otherCurrencySpaces).toEqual([{ spaceId: "space-trip", name: "Trip", currency: "USD" }]);
    expect(flow.totals).toEqual({ incoming: 0n, outgoing: 0n, closing: pesos(100_000) });
    expect(flow.lowest).toEqual({ date: "2026-10-29", balance: pesos(100_000) });
  });

  it("puts a day's pending occurrences before its scheduled ones, whatever space lists them first", () => {
    const flow = cashFlow(
      input([
        movement({ description: "Today's Internet", date: day("2026-10-29") }),
        movement({
          description: "Late gas",
          date: day("2026-10-25"),
          status: "PENDING",
          occurrenceId: "occ-gas",
          spaceId: "space-household",
        }),
      ]),
    );
    expect(flow.dates[0]!.movements.map((m) => m.description)).toEqual(["Late gas", "Today's Internet"]);
  });

  it("names the first date of the lowest balance, and today when nothing goes lower than the opening", () => {
    const dip = cashFlow(
      input([
        movement({ description: "Dip", date: day("2026-11-02"), amount: pesos(50_000) }),
        movement({
          type: "INCOME",
          description: "Back",
          date: day("2026-11-03"),
          amount: pesos(50_000),
          debitAccountId: null,
          creditAccountId: "acc-bancolombia",
        }),
        movement({ description: "Dip again", date: day("2026-11-04"), amount: pesos(50_000) }),
      ]),
    );
    expect(dip.lowest).toEqual({ date: "2026-11-02", balance: pesos(50_000) });
    const level = cashFlow(
      input([
        movement({
          type: "TRANSFER",
          description: "To Nequi",
          date: day("2026-11-02"),
          creditAccountId: "acc-nequi",
        }),
      ]),
    );
    expect(level.dates.map((d) => d.balanceAfter)).toEqual([pesos(100_000)]);
    expect(level.lowest).toEqual({ date: "2026-10-29", balance: pesos(100_000) });
  });
});
