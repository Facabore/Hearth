import { ok, type Period, type Result } from "@/shared/kernel";
import { fundContributions, type FundContribution } from "../domain/fund-contributions";
import type { MemberSumsDeps } from "./member-sums";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

/** Ruling P201 (M6c): Σ over the listed members, so the Fund screen's summary is the API's. */
export interface FundTotals {
  readonly expected: bigint;
  readonly actual: bigint;
  readonly difference: bigint;
}

export interface FundContributionReport {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  readonly plan: ReportPlan | null;
  /** Every current member in join order (ruling P7). */
  readonly members: readonly FundContribution[];
  readonly totals: FundTotals;
}

export type GetFundContributions = (input: SpaceReportInput) => Promise<Result<FundContributionReport>>;

/**
 * HU-E7-03, spec 5.4 fund level: each current member's expected contribution (their assigned amounts on the plan's
 * SHARED_FUND lines) against what they paid into the space's funds in the period (ruling P36), computed on read (D7).
 */
export const createGetFundContributions =
  (deps: MemberSumsDeps): GetFundContributions =>
  async (input) => {
    const report = await spaceReport(deps, input);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const members = await deps.members.listCurrent(space.spaceId);
    const fundLines = (view?.figures.lines ?? [])
      .filter((f) => f.line.funding === "SHARED_FUND")
      .map((f) => ({ members: f.allocation.members }));
    const actual = await deps.sums.fundContributionsByMember(space.spaceId, period.start, period.end);
    const rows = fundContributions(
      members.map((m) => m.id),
      fundLines,
      actual,
    );
    const sum = (pick: (row: FundContribution) => bigint) =>
      rows.reduce((total, row) => total + pick(row), 0n);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      period,
      plan: reportPlanOf(view),
      members: rows,
      totals: {
        expected: sum((r) => r.expected),
        actual: sum((r) => r.actual),
        difference: sum((r) => r.difference),
      },
    });
  };
