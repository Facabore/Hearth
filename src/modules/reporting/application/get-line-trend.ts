import { planViewCache } from "@/modules/budgeting/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import { changeFrom, periodsEndingWith, tracedLines, type Change } from "../domain/trend";
import type { ReportingDeps } from "./deps";
import { planViewIn, reportPlanOf, spaceReport, type ReportPlan } from "./space-report";

/** A line's figure in one period of the window; null where it has none (no plan, or no line it continues). */
export interface TrendPoint {
  readonly period: Period;
  readonly spent: bigint | null;
  /** Versus the previous period of the policy; null where `spent` is null. */
  readonly change: Change | null;
}

export interface LineTrendSeries {
  readonly lineId: string;
  readonly name: string;
  /** Aligned with the trend's periods, oldest first. */
  readonly points: readonly TrendPoint[];
}

export interface LineTrend {
  readonly spaceId: string;
  readonly currency: string;
  /** `periods` periods of the space policy, oldest first, ending with the end period (spec 5.3). */
  readonly periods: readonly Period[];
  /** The end period's plan, whose lines the trend follows; null without one, and then no lines (ruling P38). */
  readonly plan: ReportPlan | null;
  readonly lines: readonly LineTrendSeries[];
}

export interface TrendInput {
  readonly spaceId: string;
  readonly userId: string;
  /** The end period's label in the space policy. */
  readonly endPeriod: string;
  /** How many periods the window shows (HU-E7-05: 6 by default, set by the contract). */
  readonly periods: number;
}

export type GetLineTrend = (input: TrendInput) => Promise<Result<LineTrend>>;

/**
 * HU-E7-05, spec 5.3: each line of the end period's plan followed back through the window by its origin link, else
 * its name (ruling P38), with what it spent in each period (`loadPlanView`, D7) and the change from the period before;
 * the window reads one period more than it shows, so the first period shown is compared too. Every view of the
 * window shares one cache, so each plan of the carry-over chain is figured once (ruling P105).
 */
export const createGetLineTrend =
  (deps: ReportingDeps): GetLineTrend =>
  async (input) => {
    const cache = planViewCache();
    const report = await spaceReport(
      deps,
      { spaceId: input.spaceId, userId: input.userId, period: input.endPeriod },
      cache,
    );
    if (!report.ok) return report;
    const { space, period, stored, view } = report.value;
    const window = periodsEndingWith(space.periodPolicy, stored, period, input.periods + 1);
    const earlier = await Promise.all(window.slice(0, -1).map((p) => planViewIn(deps, space, p, cache)));
    const plans = [...earlier, view].map((v) =>
      v === null
        ? null
        : v.figures.lines.map((f) => ({
            id: f.line.id,
            originLineId: f.line.originLineId,
            name: f.line.name,
            spent: f.spent,
          })),
    );
    const lines = (plans.at(-1) ?? []).map((line) => {
      const spent = tracedLines(plans, line).map((traced) => traced?.spent ?? null);
      return {
        lineId: line.id,
        name: line.name,
        points: window.slice(1).map((p, i) => {
          const current = spent[i + 1] ?? null;
          return {
            period: p,
            spent: current,
            change: current === null ? null : changeFrom(spent[i] ?? null, current),
          };
        }),
      };
    });
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      periods: window.slice(1),
      plan: reportPlanOf(view),
      lines,
    });
  };
