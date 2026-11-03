import { describe, expect, it } from "vitest";
import { transactionDto } from "../../../../tests/support/ui/dto";
import { groupByDay } from "./day-groups";

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
