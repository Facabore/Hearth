import {
  categoryLinesOf,
  type CategoryLine,
  type Funding,
  type LineFigure,
} from "@/modules/budgeting/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import { lineStateOf, type LineState } from "@/shared/kernel/line-state";
import type { ReportingDeps } from "./deps";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

/** HU-E7-01: one budget line of the period's plan; `overspent` while its available amount is negative. */
export interface DashboardLine {
  readonly lineId: string;
  readonly name: string;
  readonly funding: Funding;
  readonly isCatchAll: boolean;
  readonly planned: bigint;
  readonly spent: bigint;
  readonly carryOver: bigint;
  /** Ruling P243 (M6c): the plan the carry-over comes from; it carries only once that plan is CLOSED. */
  readonly carryOverFrom: LineFigure["carryOverFrom"];
  readonly available: bigint;
  readonly overspent: boolean;
  /** Ruling P244 (M6c): of planned + carry-over; a SAVINGS line is always OK. */
  readonly state: LineState;
  /** How much an OVER line went past its budget, positive; null otherwise. */
  readonly overBy: bigint | null;
}

/** Spending no line consumes, available = −spent (HU-E6-04); `overspent` once anything was spent there. */
export interface UnbudgetedSpending {
  readonly spent: bigint;
  readonly available: bigint;
  readonly overspent: boolean;
}

/**
 * Ruling P201 (M6c): the dashboard's own sums, so a client never adds figures up. `planned` counts the lines only
 * (Unbudgeted plans nothing, HU-E6-04); `spent` and `available` count Unbudgeted too.
 */
export interface LineTotals {
  readonly planned: bigint;
  readonly spent: bigint;
  readonly available: bigint;
}

export interface LineDashboard {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  /** Null when the period has no plan; every expense is then Unbudgeted (ruling P33). */
  readonly plan: ReportPlan | null;
  /** The plan's lines in plan order; none without a plan. */
  readonly lines: readonly DashboardLine[];
  /** Null when the plan has a catch-all line, which consumes every unmapped category (HU-E6-04, ruling P34). */
  readonly unbudgeted: UnbudgetedSpending | null;
  readonly totals: LineTotals;
  /** Ruling P234 (M6c): the line each live category consumes; [] without a plan. */
  readonly categoryLines: readonly CategoryLine[];
}

export type GetLineDashboard = (input: SpaceReportInput) => Promise<Result<LineDashboard>>;

const unbudgeted = (spent: bigint): UnbudgetedSpending => ({
  spent,
  available: -spent,
  overspent: spent > 0n,
});

const totalsOf = (lines: readonly DashboardLine[], rest: UnbudgetedSpending | null): LineTotals => ({
  planned: lines.reduce((sum, line) => sum + line.planned, 0n),
  spent: lines.reduce((sum, line) => sum + line.spent, 0n) + (rest?.spent ?? 0n),
  available: lines.reduce((sum, line) => sum + line.available, 0n) + (rest?.available ?? 0n),
});

/**
 * HU-E7-01: planned, spent, carry-over and available per line of the period's plan, exactly as the plan reports
 * them (`loadPlanView`, spec 5.4, ruling P32), computed on read (D7).
 */
export const createGetLineDashboard =
  (deps: ReportingDeps): GetLineDashboard =>
  async (input) => {
    const report = await spaceReport(deps, input);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const base = { spaceId: space.spaceId, currency: space.currency, period, plan: reportPlanOf(view) };
    if (view === null) {
      const spending = await deps.spending.expensesByCategory(space.spaceId, period.start, period.end);
      const rest = unbudgeted(spending.reduce((sum, c) => sum + c.amount, 0n));
      return ok({ ...base, lines: [], unbudgeted: rest, totals: totalsOf([], rest), categoryLines: [] });
    }
    const { figures } = view;
    const lines = figures.lines.map((f) => ({
      lineId: f.line.id,
      name: f.line.name,
      funding: f.line.funding,
      isCatchAll: f.line.isCatchAll,
      planned: f.line.plannedAmount,
      spent: f.spent,
      carryOver: f.carryOver,
      carryOverFrom: f.carryOverFrom,
      available: f.available,
      overspent: f.available < 0n,
      // Ruling P244 (M6c): a savings line reaching its plan is the goal, so it is never measured.
      state:
        f.line.funding === "SAVINGS" ? "OK" : lineStateOf(f.line.plannedAmount + f.carryOver, f.available),
      overBy: f.line.funding !== "SAVINGS" && f.available < 0n ? -f.available : null,
    }));
    const rest = figures.unbudgeted === null ? null : unbudgeted(figures.unbudgeted.spent);
    const categoryLines = categoryLinesOf(view, await deps.categories.list(space.spaceId));
    return ok({ ...base, lines, unbudgeted: rest, totals: totalsOf(lines, rest), categoryLines });
  };
