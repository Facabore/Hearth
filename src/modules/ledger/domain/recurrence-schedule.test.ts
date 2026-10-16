import { describe, expect, it } from "vitest";
import type { LocalDate, PeriodPolicy } from "@/shared/kernel";
import { firstDateFrom, scheduleDates, scheduleOf } from "./recurrence-schedule";

const day = (iso: string) => iso as LocalDate;
const monthlyOn = (anchor: number): PeriodPolicy => ({ kind: "MONTHLY", day: anchor });
const twiceMonthly = (day1: number, day2: number): PeriodPolicy => ({ kind: "SEMI_MONTHLY", day1, day2 });
const dates = (schedule: PeriodPolicy, from: string, through: string | null, limit = 12) =>
  scheduleDates(schedule, { from: day(from), through: through === null ? null : day(through) }, limit);

describe("recurrence schedules (HU-E4-11, spec 5.2)", () => {
  it("lists MONTHLY(1) dates from the start date", () => {
    expect(dates(monthlyOn(1), "2026-12-01", null, 3)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });

  it("clamps MONTHLY(31) to short months: 2027-01-31, 2027-02-28 and 2027-03-31", () => {
    expect(dates(monthlyOn(31), "2027-01-01", null, 3)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });

  it("clamps MONTHLY(31) to 30 April and to 29 February in a leap year", () => {
    expect(dates(monthlyOn(31), "2027-04-01", null, 2)).toEqual(["2027-04-30", "2027-05-31"]);
    expect(dates(monthlyOn(31), "2028-02-01", null, 2)).toEqual(["2028-02-29", "2028-03-31"]);
  });

  it("falls on 29 February in a leap year", () => {
    expect(dates(monthlyOn(30), "2028-01-31", "2028-03-31")).toEqual(["2028-02-29", "2028-03-30"]);
  });

  it("lists SEMI_MONTHLY(1, 16) in December 2026 as 2026-12-01 and 2026-12-16", () => {
    expect(dates(twiceMonthly(1, 16), "2026-12-01", "2026-12-31")).toEqual(["2026-12-01", "2026-12-16"]);
  });

  it("collapses SEMI_MONTHLY(30, 31) to one date in February", () => {
    expect(dates(twiceMonthly(30, 31), "2027-02-01", "2027-03-31")).toEqual([
      "2027-02-28",
      "2027-03-30",
      "2027-03-31",
    ]);
  });

  it("keeps both SEMI_MONTHLY(15, 31) dates in February: the clamped 31 is still after the 15", () => {
    expect(dates(twiceMonthly(15, 31), "2027-02-01", "2027-03-15")).toEqual([
      "2027-02-15",
      "2027-02-28",
      "2027-03-15",
    ]);
  });

  it("starts at the first schedule date on or after the given day", () => {
    expect([
      firstDateFrom(monthlyOn(5), day("2026-12-05")),
      firstDateFrom(monthlyOn(5), day("2026-12-06")),
    ]).toEqual(["2026-12-05", "2027-01-05"]);
  });

  it("resumes a SEMI_MONTHLY schedule on its next anchor: 2027-02-10 gives 2027-02-16 (HU-E4-11)", () => {
    const schedule = twiceMonthly(1, 16);
    expect([
      firstDateFrom(schedule, day("2027-02-10")),
      firstDateFrom(schedule, day("2027-02-16")),
      firstDateFrom(schedule, day("2027-02-17")),
    ]).toEqual(["2027-02-16", "2027-02-16", "2027-03-01"]);
  });

  it("returns no dates for a window between two schedule dates", () => {
    expect(dates(monthlyOn(1), "2026-12-02", "2026-12-15")).toEqual([]);
  });

  it("includes an end date that is a clamped date, and excludes the day before it", () => {
    expect(dates(monthlyOn(31), "2027-01-01", "2027-02-28")).toEqual(["2027-01-31", "2027-02-28"]);
    expect(dates(monthlyOn(31), "2027-01-01", "2027-02-27")).toEqual(["2027-01-31"]);
  });

  it("includes an end date that is a schedule date, and stops at the limit", () => {
    expect(dates(monthlyOn(1), "2026-12-01", "2027-01-01")).toEqual(["2026-12-01", "2027-01-01"]);
    expect(dates(monthlyOn(1), "2026-12-02", "2027-01-31")).toEqual(["2027-01-01"]);
    expect(dates(monthlyOn(1), "2026-12-01", "2026-11-30")).toEqual([]);
    expect(dates(twiceMonthly(1, 16), "2026-12-01", null, 1)).toEqual(["2026-12-01"]);
  });

  it("validates anchors as a period policy does: InvalidPeriodPolicy (HU-E1-03)", () => {
    expect(scheduleOf(monthlyOn(31))).toEqual({ ok: true, value: monthlyOn(31) });
    expect(scheduleOf(twiceMonthly(1, 16))).toEqual({ ok: true, value: twiceMonthly(1, 16) });
    expect(scheduleOf(monthlyOn(0))).toMatchObject({ ok: false, error: { code: "InvalidPeriodPolicy" } });
    expect(scheduleOf(twiceMonthly(16, 1))).toMatchObject({
      ok: false,
      error: { code: "InvalidPeriodPolicy" },
    });
  });
});
