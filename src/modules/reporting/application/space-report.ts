import { loadPlanView, type BudgetPlanView, type PlanStatus } from "@/modules/budgeting/application";
import { authorizeSpaceAction, type SpaceMembership } from "@/modules/spaces/application";
import { ok, periodByLabel, type Period, type Result } from "@/shared/kernel";
import type { ReportingDeps } from "./deps";

/** Who reads which space's report, for which period label of the space policy ("2026-11", "2026-11 H1"). */
export interface SpaceReportInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly period: string;
}

/** The plan a report reads, whatever its status (ruling P33). */
export interface ReportPlan {
  readonly id: string;
  readonly status: PlanStatus;
}

/** A period of a space and the plan whose stored period it is, with every figure derived on read (D7). */
export interface SpaceReport {
  readonly space: SpaceMembership;
  readonly period: Period;
  /** Null when no plan has this period (ruling P33). */
  readonly view: BudgetPlanView | null;
}

/** The plan whose stored period holds `period`'s first day, whatever its status (ruling P33), with its figures. */
export const planViewIn = async (
  deps: ReportingDeps,
  space: SpaceMembership,
  period: Period,
): Promise<BudgetPlanView | null> => {
  const plan = await deps.plans.covering(space.spaceId, period.start);
  return plan === null ? null : loadPlanView(deps, space, plan);
};

/**
 * HU-E7-01 … HU-E7-03, HU-E7-05: every member reads a space's reports (space.read), archived spaces included
 * (HU-E1-09). The period is the stored one with that label, else the policy's period around the stored ones (D10).
 */
export const spaceReport = async (
  deps: ReportingDeps,
  input: SpaceReportInput,
): Promise<Result<SpaceReport>> => {
  const scoped = await spacePeriod(deps, input);
  if (!scoped.ok) return scoped;
  const { space, period } = scoped.value;
  return ok({ space, period, view: await planViewIn(deps, space, period) });
};

/**
 * HU-E7-01 … HU-E7-06: the reader's membership (space.read, every role, archived spaces included) and the period
 * named `input.period`: the stored one with that label, else the policy's period around the stored ones (D10).
 */
export const spacePeriod = async (
  deps: Pick<ReportingDeps, "access" | "plans">,
  input: SpaceReportInput,
): Promise<Result<{ readonly space: SpaceMembership; readonly period: Period }>> => {
  const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
  if (!reader.ok) return reader;
  const space = reader.value;
  const period = periodByLabel(
    space.periodPolicy,
    await deps.plans.storedPeriods(space.spaceId),
    input.period,
  );
  if (!period.ok) return period;
  return ok({ space, period: period.value });
};

export const reportPlanOf = (view: BudgetPlanView | null): ReportPlan | null =>
  view === null ? null : { id: view.plan.id, status: view.plan.status };
