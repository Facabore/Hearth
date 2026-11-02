import { describe, expect, it } from "vitest";
import { cop, transactionDto } from "../../../../tests/support/ui/dto";
import { dayNet, groupByDay } from "./day-groups";

describe("groupByDay (HU-E9-03, ruling P130)", () => {
  it("keeps the API's order and names today and yesterday only", () => {
    const items = [
      transactionDto({ id: "t1", date: "2026-10-31" }),
      transactionDto({ id: "t2", date: "2026-10-30" }),
      transactionDto({ id: "t3", date: "2026-10-30" }),
      transactionDto({ id: "t4", date: "2026-10-29" }),
    ];
    expect(
      groupByDay(items, "2026-10-31").map((g) => [g.date, g.relative, g.items.map((t) => t.id)]),
    ).toEqual([
      ["2026-10-31", "today", ["t1"]],
      ["2026-10-30", "yesterday", ["t2", "t3"]],
      ["2026-10-29", null, ["t4"]],
    ]);
  });

  it("starts a new group whenever the date changes, and has none for no rows", () => {
    const items = [
      transactionDto({ id: "t1", date: "2026-10-30" }),
      transactionDto({ id: "t2", date: "2026-10-29" }),
      transactionDto({ id: "t3", date: "2026-10-30" }),
    ];
    expect(groupByDay(items, "2026-10-31").map((g) => g.items.map((t) => t.id))).toEqual([
      ["t1"],
      ["t2"],
      ["t3"],
    ]);
    expect(groupByDay([], "2026-10-31")).toEqual([]);
  });

  it("names the day by the person's today, not by a rolled-over one", () => {
    const items = [transactionDto({ id: "t1", date: "2026-10-31" })];
    expect(groupByDay(items, "2026-11-01")[0]?.relative).toBe("yesterday");
    expect(groupByDay(items, "2026-10-31")[0]?.relative).toBe("today");
    expect(groupByDay(items, "2026-11-02")[0]?.relative).toBeNull();
  });
});

describe("a day's total (board B1 06, ruling P277)", () => {
  const of = (type: "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT", pesos: number) =>
    transactionDto({ type, amount: cop(pesos) });

  it("is what came in less what was spent, in exact minor units", () => {
    expect(dayNet([of("EXPENSE", 18_000), of("EXPENSE", 100_000)])).toEqual(cop(-118_000));
    expect(dayNet([of("INCOME", 3_200_000), of("EXPENSE", 200_000)])).toEqual(cop(3_000_000));
    // 0.1 + 0.2 in a float is 0.30000000000000004: minor units in bigint never drift.
    const cents = (amount: string) =>
      transactionDto({ type: "EXPENSE", amount: { amount, currency: "USD" } });
    expect(dayNet([cents("10"), cents("20")])).toEqual({ amount: "-30", currency: "USD" });
  });

  it("leaves transfers and payments between members out, and is none for a day without spending or income", () => {
    expect(dayNet([of("TRANSFER", 500_000), of("EXPENSE", 60_000)])).toEqual(cop(-60_000));
    expect(dayNet([of("TRANSFER", 500_000), of("SETTLEMENT", 20_000)])).toBeNull();
    expect(dayNet([])).toBeNull();
  });
});
