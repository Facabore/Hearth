import {
  lineForCategory,
  planViewCache,
  rolledUpCategory,
  viewReadsOf,
  type LineFigure,
} from "@/modules/budgeting/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import { fundContributions, type FundContribution } from "../domain/fund-contributions";
import { compareText } from "../domain/unified-view";
import type { MemberSumsDeps } from "./member-sums";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

/** Ruling P201 (M6c): Σ over the listed members, so the Fund screen's summary is the API's. */
export interface FundTotals {
  readonly expected: bigint;
  readonly actual: bigint;
  readonly difference: bigint;
}

/** #240: a space's live fund accounts (SHARED_FUND, HU-E2-02), which every member reads in its accounts. */
export interface SpaceFunds {
  fundsOf(spaceId: string): Promise<readonly { readonly id: string; readonly name: string }[]>;
}

export interface FundDeps extends MemberSumsDeps {
  readonly funds: SpaceFunds;
}

/** D26: what a member paid directly for the fund on one line of the plan, in the period. */
export interface PaidDirectly {
  readonly lineId: string;
  readonly name: string;
  readonly amount: bigint;
}

export interface FundContributionReport {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  readonly plan: ReportPlan | null;
  /**
   * Every current member in join order (ruling P7). D26: `paidDirectly` lists, in plan order, the lines the member
   * usually pays and those they paid an expense of for the fund, with what they paid (part of `actual`).
   */
  readonly members: readonly (FundContribution & { readonly paidDirectly: readonly PaidDirectly[] })[];
  readonly totals: FundTotals;
  /** #240 (board E9-10 04): the space's live fund accounts by name, so a screen says whose fund it tracks. */
  readonly funds: readonly { readonly id: string; readonly name: string }[];
}

export type GetFundContributions = (input: SpaceReportInput) => Promise<Result<FundContributionReport>>;

/**
 * D26: per member, the lines they usually pay (named on the line) and the lines whose expenses they paid for the fund
 * in the period, with what they paid on each. An expense in a subcategory counts on its category's line (HU-E3-04), and
 * one no line consumes is left out, as the plan's spending leaves it.
 */
const paidDirectlyByMember = async (
  deps: FundDeps,
  space: Parameters<typeof viewReadsOf>[1],
  period: Period,
  figures: readonly LineFigure[],
  cache: ReturnType<typeof planViewCache>,
): Promise<(memberId: string) => PaidDirectly[]> => {
  if (figures.length === 0) return () => [];
  const rows = await deps.sums.paidForFundByCategory(space.spaceId, period.start, period.end);
  const { categories } = await viewReadsOf(deps, space, cache);
  const parts = {
    lines: figures.map((f) => f.line),
    mappings: figures.flatMap((f) => f.categoryIds.map((categoryId) => ({ lineId: f.line.id, categoryId }))),
  };
  const paid = new Map<string, bigint>();
  for (const row of rows) {
    const lineId = lineForCategory(rolledUpCategory(row.categoryId, categories), parts);
    if (lineId === null) continue;
    const key = `${lineId}/${row.memberId}`;
    paid.set(key, (paid.get(key) ?? 0n) + row.amount);
  }
  return (memberId) =>
    figures.flatMap(({ line }) => {
      const amount = paid.get(`${line.id}/${memberId}`);
      return amount === undefined && !line.payerMemberIds.includes(memberId)
        ? []
        : [{ lineId: line.id, name: line.name, amount: amount ?? 0n }];
    });
};

/**
 * HU-E7-03, spec 5.4 fund level: each current member's expected contribution (their assigned amounts on the plan's
 * SHARED_FUND lines) against what they paid into the space's funds in the period (ruling P36), computed on read (D7).
 */
export const createGetFundContributions =
  (deps: FundDeps): GetFundContributions =>
  async (input) => {
    const cache = planViewCache();
    const report = await spaceReport(deps, input, cache);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    // The members the view was figured against, read once in the request.
    const members =
      view === null
        ? await deps.members.listCurrent(space.spaceId)
        : (await viewReadsOf(deps, space, cache)).members;
    const fundLines = (view?.figures.lines ?? [])
      .filter((f) => f.line.funding === "SHARED_FUND")
      .map((f) => ({ members: f.allocation.members }));
    const actual = await deps.sums.fundContributionsByMember(space.spaceId, period.start, period.end);
    const rows = fundContributions(
      members.map((m) => m.id),
      fundLines,
      actual,
    );
    const direct = await paidDirectlyByMember(deps, space, period, view?.figures.lines ?? [], cache);
    const funds = [...(await deps.funds.fundsOf(space.spaceId))]
      .sort((a, b) => compareText(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(({ id, name }) => ({ id, name }));
    const sum = (pick: (row: FundContribution) => bigint) =>
      rows.reduce((total, row) => total + pick(row), 0n);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      period,
      plan: reportPlanOf(view),
      members: rows.map((row) => ({ ...row, paidDirectly: direct(row.memberId) })),
      totals: {
        expected: sum((r) => r.expected),
        actual: sum((r) => r.actual),
        difference: sum((r) => r.difference),
      },
      funds,
    });
  };
