import type { LineDashboardDto, SpaceDto } from "@/shared/ui/api/dto";
import { cop, spaceDto } from "./dto";

/** "Household": Ana's shared space, OWNER, MONTHLY(1), COP. */
export const householdDto = (overrides: Partial<SpaceDto> = {}): SpaceDto =>
  spaceDto({ id: "sp-household", name: "Household", kind: "SHARED", role: "OWNER", ...overrides });

export const NOVEMBER = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" } as const;

type DashLine = LineDashboardDto["lines"][number];
const dashLine = (
  lineId: string,
  name: string,
  [planned, spent, available]: readonly [number, number, number],
  extra: Partial<DashLine> = {},
): DashLine => ({
  lineId,
  name,
  funding: "DIRECT",
  isCatchAll: false,
  planned: cop(planned),
  spent: cop(spent),
  carryOver: cop(0),
  // Task 1e (ruling P243): where a carry-over comes from; null for a line that carries nothing.
  carryOverFrom: null,
  available: cop(available),
  overspent: available < 0,
  // Task 1b: the line's state and its overage.
  state: available < 0 ? "OVER" : "OK",
  overBy: available < 0 ? cop(-available) : null,
  ...extra,
});

/** HU-E7-01's November 2026 dashboard of the E7 shared fixture, with the totals the API answers (Task 1). */
export const e7Dashboard = (overrides: Partial<LineDashboardDto> = {}): LineDashboardDto => ({
  spaceId: "sp-household",
  period: { ...NOVEMBER },
  plan: { id: "p-nov", status: "ACTIVE" },
  lines: [
    dashLine("l-rent", "Rent", [1_200_000, 1_200_000, 0], { funding: "SHARED_FUND", state: "HIGH" }),
    dashLine("l-home", "Home", [1_470_000, 1_300_000, 170_000], { state: "NEAR" }),
    dashLine("l-savings", "Savings", [600_000, 0, 600_000], { funding: "SAVINGS" }),
    dashLine("l-free", "Free", [730_000, 250_000, 480_000]),
  ],
  unbudgeted: { spent: cop(60_000), available: cop(-60_000), overspent: true },
  totals: { planned: cop(4_000_000), spent: cop(2_810_000), available: cop(1_190_000) },
  // Task 1b (ruling P234): the line each category consumes.
  categoryLines: [
    { categoryId: "c-rent", lineId: "l-rent" },
    { categoryId: "c-groceries", lineId: "l-home" },
    { categoryId: "c-utilities", lineId: "l-home" },
    { categoryId: "c-entertainment", lineId: "l-free" },
    { categoryId: "c-restaurants", lineId: null },
  ],
  ...overrides,
});
