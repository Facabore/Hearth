import { describe, expect, it } from "vitest";
import { periodByLabel, type Period, type PeriodPolicy, type StoredPeriod } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { openPlan, type BudgetPlanId } from "./plan";

const now = new Date("2026-10-14T12:00:00Z");
const MONTHLY_1: PeriodPolicy = { kind: "MONTHLY", day: 1 };
const SEMI_1_16: PeriodPolicy = { kind: "SEMI_MONTHLY", day1: 1, day2: 16 };
const open = (period: Period, stored: readonly StoredPeriod[] = []) =>
  openPlan({
    id: "plan-1" as BudgetPlanId,
    spaceId: "space-household",
    period,
    stored,
    createdBy: "u-ana",
    now,
  });

describe("openPlan (HU-E6-01)", () => {
  it("opens a DRAFT plan for 2026-11 that runs from 2026-11-01 to 2026-11-30", () => {
    const november = unwrap(periodByLabel(MONTHLY_1, [], "2026-11"));
    expect(unwrap(open(november))).toEqual({
      id: "plan-1",
      spaceId: "space-household",
      period: { label: "2026-11", start: "2026-11-01", end: "2026-11-30" },
      status: "DRAFT",
      createdFrom: null,
      version: 1,
      createdBy: "u-ana",
      createdAt: now,
    });
  });

  it("allows only one plan per period", () => {
    const november = unwrap(periodByLabel(MONTHLY_1, [], "2026-11"));
    const again = unwrap(periodByLabel(MONTHLY_1, [november], "2026-11"));
    const refused = open(again, [november]);
    expect(refused).toEqual({
      ok: false,
      error: { code: "PlanAlreadyExists", details: { label: "2026-11" } },
    });
  });

  it("gives a semi-monthly space two plans per month, 2026-11 H1 and 2026-11 H2", () => {
    const h1 = unwrap(periodByLabel(SEMI_1_16, [], "2026-11 H1"));
    const h2 = unwrap(periodByLabel(SEMI_1_16, [h1], "2026-11 H2"));
    expect([h1, h2]).toEqual([
      { label: "2026-11 H1", start: "2026-11-01", end: "2026-11-15" },
      { label: "2026-11 H2", start: "2026-11-16", end: "2026-11-30" },
    ]);
    expect(codeOf(open(h2, [h1]))).toBe("ok");
  });
});
