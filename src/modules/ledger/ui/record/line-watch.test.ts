import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { e7Dashboard } from "../../../../../tests/support/ui/plan-dto";
import { asksFirst, lineWarningOf, lineWatchOf } from "./line-watch";

const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const minor = (pesos: number) => String(pesos * 100);

/** One line, 1,000,000 COP planned and 700,000 spent, fed by Groceries; Free is fed by Restaurants. */
const watchOf = (home: { planned?: number; spent?: number; carryOver?: number; available?: number } = {}) => {
  const dashboard = e7Dashboard({ period: OCTOBER });
  dashboard.lines[1] = {
    ...dashboard.lines[1]!,
    planned: cop(home.planned ?? 1_000_000),
    spent: cop(home.spent ?? 700_000),
    carryOver: cop(home.carryOver ?? 0),
    available: cop(home.available ?? 300_000),
  };
  return lineWatchOf({
    ...dashboard,
    categoryLines: [
      { categoryId: "c-groceries", lineId: "l-home" },
      { categoryId: "c-savings", lineId: "l-savings" },
      { categoryId: "c-restaurants", lineId: null },
    ],
  });
};
const warn = (
  pesos: number,
  overrides: Partial<Parameters<typeof lineWarningOf>[1]> = {},
  watch = watchOf(),
) =>
  lineWarningOf(watch, {
    categoryId: "c-groceries",
    parentId: null,
    amountMinor: minor(pesos),
    date: "2026-10-31",
    currency: "COP",
    ...overrides,
  });

describe("the line warning (#142, rulings P235 and P236 of M6c)", () => {
  it("says nothing below 80 %, notes from 80 % through 90 %, and asks above 90 % or over the line", () => {
    expect(warn(99_999)).toBeNull();
    expect(warn(100_000)).toEqual({ level: "NEAR", line: "Home", used: "80.00", rest: cop(200_000) });
    expect(warn(200_000)).toEqual({ level: "NEAR", line: "Home", used: "90.00", rest: cop(100_000) });
    expect(warn(200_100)).toEqual({ level: "HIGH", line: "Home", used: "90.01", rest: cop(99_900) });
    expect(warn(300_000)).toEqual({ level: "HIGH", line: "Home", used: "100.00", rest: cop(0) });
    expect(warn(342_300)).toEqual({ level: "OVER", line: "Home", used: null, rest: cop(42_300) });
    expect([warn(100_000), warn(200_100), warn(342_300)].map(asksFirst)).toEqual([false, true, true]);
  });

  it("measures the line against planned plus what it carried in (HU-E6-09)", () => {
    const carrying = watchOf({ planned: 1_000_000, carryOver: 500_000, spent: 700_000, available: 800_000 });
    // 700,000 + 300,000 of 1,500,000 is 66.66 %: no note, where Planned alone would have asked.
    expect(warn(300_000, {}, carrying)).toBeNull();
    expect(warn(500_000, {}, carrying)).toEqual({
      level: "NEAR",
      line: "Home",
      used: "80.00",
      rest: cop(300_000),
    });
  });

  it("checks a subcategory by its parent's line and says nothing for Unbudgeted, a savings line or no category", () => {
    expect(warn(100_000, { categoryId: "c-veg", parentId: "c-groceries" })?.level).toBe("NEAR");
    expect(warn(342_300, { categoryId: "c-restaurants" })).toBeNull();
    expect(warn(342_300, { categoryId: "c-savings" })).toBeNull();
    expect(warn(342_300, { categoryId: null })).toBeNull();
  });

  it("says nothing outside the loaded period, in another currency, for no amount, or without an ACTIVE plan", () => {
    expect(warn(342_300, { date: "2026-11-01" })).toBeNull();
    expect(warn(342_300, { currency: "USD" })).toBeNull();
    expect(warn(342_300, { amountMinor: null })).toBeNull();
    expect(lineWatchOf(e7Dashboard({ plan: { id: "p-nov", status: "DRAFT" } }))).toBeNull();
    expect(lineWatchOf(e7Dashboard({ plan: { id: "p-nov", status: "CLOSED" } }))).toBeNull();
    expect(lineWatchOf(e7Dashboard({ plan: null, lines: [] }))).toBeNull();
    expect(
      lineWarningOf(null, {
        categoryId: "c-groceries",
        parentId: null,
        amountMinor: "1",
        date: "2026-10-31",
        currency: "COP",
      }),
    ).toBeNull();
  });
});
