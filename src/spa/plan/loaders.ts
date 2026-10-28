import { notFound } from "@tanstack/react-router";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { PeriodDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { ensurer, viewerOf, type Load, type Viewer } from "../load";
import { ProblemError } from "../read";
import {
  accountsQuery,
  capacitySuggestionQuery,
  cashFlowQuery,
  categoriesQuery,
  lineReportQuery,
  lineTrendQuery,
  membersQuery,
  overviewQuery,
  periodQuery,
  personalGroupsQuery,
  personalTrendQuery,
  planQuery,
  spaceReportQuery,
  unifiedViewQuery,
} from "../reads";

/** The Plan tab's views (ruling P200), each its own address under `/plan`; "home" is the tab's own page. */
export type PlanView = "home" | "lines" | "groups" | "trend" | "fund" | "members" | "calendar";

/** A view's query string, as the Next.js pages read it. */
export interface PlanSearch {
  readonly period?: string | undefined;
  readonly periods?: string | undefined;
  readonly days?: string | undefined;
}

/** Ruling P219: `?periods=12` asks for twelve; anything else is the default six. */
export const windowOf = (asked: string | undefined): 6 | 12 => (asked === "12" ? 12 : 6);

/** Ruling P241 (M6c): `?days=60` asks for 60 days; anything else is the default 30. */
export const daysOf = (asked: string | undefined): 30 | 60 => (asked === "60" ? 60 : 30);

/** The API named no period holding today: the screen says so, as the Next.js containers do. */
export const noPeriod = () =>
  new ProblemError({ code: "Unknown", status: 200, requestId: null, errors: [], field: null });

const settled = (read: Promise<unknown>): Promise<void> =>
  read.then(
    () => undefined,
    () => undefined,
  );

/** Ruling P205: the label asked for, else the label of the space's period holding today in the person's zone. */
export const reportLabel = async (load: Load, viewer: Viewer, asked: string | undefined): Promise<string> => {
  if (asked) return asked;
  const today = nowIn(new Date(), viewer.me.timezone).date;
  const period = await ensurer(load)(periodQuery(load.apis.api, viewer.space.id, today));
  if (!period) throw noPeriod();
  return period.label;
};

/** The periods before and after `period` (P130), each one that fails just absent. */
const loadNeighbours = (load: Load, spaceId: string, period: PeriodDto) => {
  const ensure = ensurer(load);
  return Promise.all([
    settled(ensure(periodQuery(load.apis.api, spaceId, addDays(period.startDate as LocalDate, -1)))),
    settled(ensure(periodQuery(load.apis.api, spaceId, addDays(period.endDate as LocalDate, 1)))),
  ]);
};

/**
 * HU-E9-10, HU-E9-11: a Plan tab view's reads. The personal space shows the person's own reports (My spending, their
 * groups and trend, Próximos); a shared one the space's (Lines with the desktop overview, groups, trend, fund, members).
 * A view a space does not have is not found, as the Next.js containers answer.
 */
export const loadPlanView = async (load: Load, spaceId: string, view: PlanView, search: PlanSearch) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = await viewerOf(load, spaceId);
  if (!viewer) throw notFound();
  const personal = viewer.space.kind === "PERSONAL";
  if ((view === "fund" || view === "members") && personal) throw notFound();
  if (view === "calendar") {
    if (!personal) throw notFound();
    await ensure(cashFlowQuery(api, spaceId, daysOf(search.days)));
    return;
  }
  const label = await reportLabel(load, viewer, search.period);
  if (view === "home" && personal) {
    const [unified] = await Promise.all([
      ensure(unifiedViewQuery(api, spaceId, label)),
      settled(ensure(lineReportQuery(api, spaceId, label))),
    ]);
    await loadNeighbours(load, spaceId, unified.period);
  } else if (view === "home" || view === "lines") {
    const dashboard = await ensure(lineReportQuery(api, spaceId, label));
    await Promise.all([
      loadNeighbours(load, spaceId, dashboard.period),
      !personal && dashboard.plan !== null ? settled(ensure(overviewQuery(api, spaceId, label))) : undefined,
    ]);
  } else if (view === "groups") {
    const report = personal
      ? await ensure(personalGroupsQuery(api, spaceId, label))
      : await ensure(spaceReportQuery(api, spaceId, "spending-by-group", label));
    await loadNeighbours(load, spaceId, report.period);
  } else if (view === "trend") {
    const periods = windowOf(search.periods);
    const trend = personal
      ? await ensure(personalTrendQuery(api, spaceId, label, periods))
      : await ensure(lineTrendQuery(api, spaceId, label, periods));
    const last = trend.periods.at(-1);
    if (!last) throw noPeriod();
    await loadNeighbours(load, spaceId, last);
  } else {
    const [report] = await Promise.all([
      ensure(spaceReportQuery(api, spaceId, view === "fund" ? "fund-contributions" : "member-matrix", label)),
      ensure(membersQuery(api, spaceId)),
    ]);
    await loadNeighbours(load, spaceId, report.period);
  }
};

/** HU-E9-08: the plan, the space's members and its categories, archived ones too (the copy notice names them, P209). */
export const loadPlanner = async (load: Load, spaceId: string, planId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  await Promise.all([
    ensure(planQuery(api, spaceId, planId)),
    ensure(membersQuery(api, spaceId)),
    ensure(categoriesQuery(api, spaceId, "all")),
  ]);
};

/** HU-E9-08: the plan, the members and the caller's own suggestion, which never blocks the screen (P208). */
export const loadCapacities = async (load: Load, spaceId: string, planId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  await Promise.all([
    ensure(planQuery(api, spaceId, planId)),
    ensure(membersQuery(api, spaceId)),
    ensure(capacitySuggestionQuery(api, spaceId, planId)),
  ]);
};

/** HU-E9-08: the plan, the caller's own savings accounts (P213), the active categories and the members. */
export const loadLineEditor = async (load: Load, spaceId: string, planId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = await viewerOf(load, spaceId);
  if (!viewer) throw notFound();
  await Promise.all([
    ensure(planQuery(api, spaceId, planId)),
    ensure(accountsQuery(api, personalSpaceOf(viewer.spaces).id, "active")),
    ensure(categoriesQuery(api, spaceId, "active")),
    ensure(membersQuery(api, spaceId)),
  ]);
};
