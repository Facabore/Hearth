import type { BudgetLine, BudgetLineId } from "@/modules/budgeting/domain/budget-line";

const CREATED = new Date("2026-10-14T12:00:00Z");

/** A line of `plan-november` with the id `line-<name>`: DIRECT, RESET and PROPORTIONAL unless overridden. */
export const aLine = (
  name: string,
  plannedAmount: bigint,
  overrides: Partial<BudgetLine> = {},
): BudgetLine => ({
  id: `line-${name.toLowerCase()}` as BudgetLineId,
  planId: "plan-november",
  originLineId: null,
  name,
  plannedAmount,
  funding: "DIRECT",
  savingsAccountIds: [],
  rolloverMode: "RESET",
  isCatchAll: false,
  allocationRule: "PROPORTIONAL",
  createdAt: CREATED,
  ...overrides,
});

/** Spec section 4: Rent (shared fund), Home, Savings (into acc-savings) and Free (catch-all), 4,000,000 COP in all. */
export const referenceLines = (): BudgetLine[] => [
  aLine("Rent", 120_000_000n, { funding: "SHARED_FUND", createdAt: new Date("2026-10-14T12:00:00Z") }),
  aLine("Home", 147_000_000n, { createdAt: new Date("2026-10-14T12:01:00Z") }),
  aLine("Savings", 60_000_000n, {
    funding: "SAVINGS",
    savingsAccountIds: ["acc-savings"],
    createdAt: new Date("2026-10-14T12:02:00Z"),
  }),
  aLine("Free", 73_000_000n, { isCatchAll: true, createdAt: new Date("2026-10-14T12:03:00Z") }),
];
