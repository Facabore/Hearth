import type { Funding } from "@/modules/budgeting/application";
import { ok, type Period, type Result } from "@/shared/kernel";
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
  readonly available: bigint;
  readonly overspent: boolean;
}

/** Spending no line consumes, available = −spent (HU-E6-04); `overspent` once anything was spent there. */
export interface UnbudgetedSpending {
  readonly spent: bigint;
  readonly available: bigint;
  readonly overspent: boolean;
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
}

export type GetLineDashboard = (input: SpaceReportInput) => Promise<Result<LineDashboard>>;

const unbudgeted = (spent: bigint): UnbudgetedSpending => ({
  spent,
  available: -spent,
  overspent: spent > 0n,
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
      return ok({
        ...base,
        lines: [],
        unbudgeted: unbudgeted(spending.reduce((sum, c) => sum + c.amount, 0n)),
      });
    }
    const { figures } = view;
    return ok({
      ...base,
      lines: figures.lines.map((f) => ({
        lineId: f.line.id,
        name: f.line.name,
        funding: f.line.funding,
        isCatchAll: f.line.isCatchAll,
        planned: f.line.plannedAmount,
        spent: f.spent,
        carryOver: f.carryOver,
        available: f.available,
        overspent: f.available < 0n,
      })),
      unbudgeted: figures.unbudgeted === null ? null : unbudgeted(figures.unbudgeted.spent),
    });
  };
