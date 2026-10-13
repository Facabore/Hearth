import { describe, expect, it } from "vitest";
import { localDate, type LocalDate } from "./local-date";
import { monthly, periodFor, semiMonthly, type PeriodPolicy } from "./period-policy";
import { listPeriods, periodByLabel, resolvePeriod, type StoredPeriod } from "./period-resolution";
import type { Result } from "./result";

const unwrap = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
const d = (iso: string): LocalDate => unwrap(localDate(iso));
const M1 = unwrap(monthly(1));
const M25 = unwrap(monthly(25));
const M31 = unwrap(monthly(31));
const S1_16 = unwrap(semiMonthly(1, 16));
const S5_20 = unwrap(semiMonthly(5, 20));
const plan: StoredPeriod = { start: d("2026-11-01"), end: d("2026-11-30"), label: "2026-11" };

describe("resolvePeriod", () => {
  it("derives the period from the policy when nothing is stored", () => {
    expect(resolvePeriod(M25, [], d("2026-10-24"))).toEqual(periodFor(M25, d("2026-10-24")));
  });

  it("returns the stored period that covers the date", () => {
    expect(resolvePeriod(M25, [plan], d("2026-11-10"))).toEqual(plan);
  });

  it("starts an overlapping derived period the day after the stored one ends (HU-E1-03)", () => {
    expect(resolvePeriod(M25, [plan], d("2026-12-10"))).toEqual({
      start: "2026-12-01",
      end: "2026-12-24",
      label: "2026-12",
    });
  });

  it("ends an overlapping derived period the day before the stored one starts", () => {
    expect(resolvePeriod(M25, [plan], d("2026-10-28"))).toEqual({
      start: "2026-10-25",
      end: "2026-10-31",
      label: "2026-11",
    });
  });
});

describe("listPeriods", () => {
  it("keeps a planned period and follows the new policy after it (HU-E1-03)", () => {
    expect(listPeriods(M25, [plan], d("2026-11-01"), 3)).toEqual([
      plan,
      { start: "2026-12-01", end: "2026-12-24", label: "2026-12" },
      { start: "2026-12-25", end: "2027-01-24", label: "2027-01" },
    ]);
  });

  it("tiles SEMI_MONTHLY(5, 20) periods (HU-E1-03)", () => {
    expect(listPeriods(S5_20, [], d("2026-11-03"), 3)).toEqual([
      { start: "2026-10-20", end: "2026-11-04", label: "2026-10 H2" },
      { start: "2026-11-05", end: "2026-11-19", label: "2026-11 H1" },
      { start: "2026-11-20", end: "2026-12-04", label: "2026-11 H2" },
    ]);
  });
});

describe("periodByLabel", () => {
  it.each<[string, PeriodPolicy, string, string, string]>([
    ["MONTHLY(1)", M1, "2026-10", "2026-10-01", "2026-10-31"],
    ["MONTHLY(25)", M25, "2026-11", "2026-10-25", "2026-11-24"],
    ["SEMI_MONTHLY(1, 16)", S1_16, "2026-11 H1", "2026-11-01", "2026-11-15"],
    ["SEMI_MONTHLY(1, 16)", S1_16, "2026-11 H2", "2026-11-16", "2026-11-30"],
    ["MONTHLY(31)", M31, "2027-03", "2027-02-28", "2027-03-30"],
    ["MONTHLY(31)", M31, "2027-02", "2027-01-31", "2027-02-27"],
  ])("%s resolves %s to %s..%s", (_name, policy, label, start, end) => {
    expect(unwrap(periodByLabel(policy, [], label))).toEqual({ start, end, label });
  });

  it.each<[string, PeriodPolicy, string]>([
    ["a malformed label", M1, "October"],
    ["month 13", M1, "2026-13"],
    ["month 00", M1, "2026-00"],
    ["a half label for a monthly policy", M1, "2026-11 H1"],
    ["a monthly label for a semi-monthly policy", S1_16, "2026-11"],
    ["a half that collapses in February", unwrap(semiMonthly(29, 31)), "2027-02 H2"],
  ])("rejects %s with InvalidPeriodLabel", (_name, policy, label) => {
    const result = periodByLabel(policy, [], label);
    expect(!result.ok && result.error.code).toBe("InvalidPeriodLabel");
  });

  it("prefers a stored period with that label and clips derived periods around stored ones", () => {
    expect(unwrap(periodByLabel(M25, [plan], "2026-11"))).toEqual(plan);
    expect(unwrap(periodByLabel(M25, [plan], "2026-12"))).toEqual({
      start: "2026-12-01",
      end: "2026-12-24",
      label: "2026-12",
    });
  });

  it("rejects a derived label whose days are all inside stored periods", () => {
    const quarter: StoredPeriod = { start: d("2026-10-01"), end: d("2026-12-31"), label: "2026-Q4" };
    const result = periodByLabel(M1, [quarter], "2026-11");
    expect(!result.ok && result.error.code).toBe("InvalidPeriodLabel");
  });
});

describe("labels outside the supported years", () => {
  it.each(["0000-01", "0050-03", "1899-12"])("rejects %s with InvalidPeriodLabel", (label) => {
    const result = periodByLabel(M1, [], label);
    expect(!result.ok && result.error.code).toBe("InvalidPeriodLabel");
  });
});
