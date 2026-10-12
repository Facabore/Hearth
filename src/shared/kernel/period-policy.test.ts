import { describe, expect, it } from "vitest";
import { localDate, type LocalDate } from "./local-date";
import { DEFAULT_PERIOD_POLICY, monthly, periodFor, semiMonthly, type PeriodPolicy } from "./period-policy";
import { isErr, type Result } from "./result";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const d = (iso: string): LocalDate => unwrap(localDate(iso));

describe("PeriodPolicy", () => {
  it.each([
    [1, "2026-10-31", "2026-10-01", "2026-10-31", "2026-10"],
    [1, "2026-11-01", "2026-11-01", "2026-11-30", "2026-11"],
    [15, "2026-11-20", "2026-11-15", "2026-12-14", "2026-11"],
    [16, "2026-10-20", "2026-10-16", "2026-11-15", "2026-11"],
    [25, "2026-10-24", "2026-09-25", "2026-10-24", "2026-10"],
    [25, "2026-10-25", "2026-10-25", "2026-11-24", "2026-11"],
    [25, "2027-01-10", "2026-12-25", "2027-01-24", "2027-01"],
    [25, "2026-12-31", "2026-12-25", "2027-01-24", "2027-01"],
  ])("MONTHLY(%i) puts %s in %s..%s labelled %s", (day, date, start, end, label) => {
    expect(periodFor(unwrap(monthly(day)), d(date))).toEqual({ start, end, label });
  });

  it.each([
    ["2027-02-27", "2027-01-31", "2027-02-27"],
    ["2027-02-28", "2027-02-28", "2027-03-30"],
    ["2028-02-29", "2028-02-29", "2028-03-30"],
  ])("MONTHLY(31) clamps short months: %s in %s..%s", (date, start, end) => {
    const period = periodFor(unwrap(monthly(31)), d(date));
    expect([period.start, period.end]).toEqual([start, end]);
  });

  it.each([
    [1, 16, "2026-11-10", "2026-11-01", "2026-11-15", "2026-11 H1"],
    [1, 16, "2026-11-20", "2026-11-16", "2026-11-30", "2026-11 H2"],
    [5, 20, "2026-11-03", "2026-10-20", "2026-11-04", "2026-10 H2"],
    [5, 20, "2027-01-04", "2026-12-20", "2027-01-04", "2026-12 H2"],
  ])("SEMI_MONTHLY(%i, %i) puts %s in %s..%s labelled %s", (day1, day2, date, start, end, label) => {
    expect(periodFor(unwrap(semiMonthly(day1, day2)), d(date))).toEqual({ start, end, label });
  });

  it.each<[string, Result<PeriodPolicy>]>([
    ["MONTHLY(0)", monthly(0)],
    ["MONTHLY(32)", monthly(32)],
    ["MONTHLY(1.5)", monthly(1.5)],
    ["MONTHLY(NaN)", monthly(Number.NaN)],
    ["SEMI_MONTHLY(16, 16)", semiMonthly(16, 16)],
    ["SEMI_MONTHLY(20, 5)", semiMonthly(20, 5)],
    ["SEMI_MONTHLY(0, 15)", semiMonthly(0, 15)],
    ["SEMI_MONTHLY(1, 32)", semiMonthly(1, 32)],
  ])("rejects %s", (_name, result) => {
    expect(isErr(result) && result.error.code).toBe("InvalidPeriodPolicy");
  });

  it("defaults to MONTHLY(1)", () => {
    expect(DEFAULT_PERIOD_POLICY).toEqual({ kind: "MONTHLY", day: 1 });
  });

  it("collapses semi-monthly anchors that clamp to the same day", () => {
    // SEMI_MONTHLY(29, 31) in February 2027: both anchors clamp to the 28th
    const period = periodFor(unwrap(semiMonthly(29, 31)), d("2027-02-28"));
    expect(period).toEqual({ start: "2027-02-28", end: "2027-03-28", label: "2027-02 H1" });
  });

  it("tiles consecutive days without gaps or overlaps", () => {
    const policies = [unwrap(monthly(31)), unwrap(monthly(25)), unwrap(semiMonthly(15, 30))];
    for (const policy of policies) {
      let period = periodFor(policy, d("2027-01-01"));
      while (period.end < "2028-12-31") {
        const next = periodFor(policy, d(nextDay(period.end)));
        expect(next.start).toBe(nextDay(period.end));
        expect(next.start <= next.end).toBe(true);
        period = next;
      }
    }
  });
});

const nextDay = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};
