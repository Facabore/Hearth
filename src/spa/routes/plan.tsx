import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { PlanView as FrameView } from "@/modules/reporting/ui";
import {
  DashboardFrame,
  DashOverview,
  FundTracking,
  LazyCashFlowCalendar,
  LineDashboard,
  LineTrend,
  MemberMatrix,
  NoPlan,
  PersonalTrend,
  SpendingChart,
  treeOf,
  unbudgetedNamesOf,
} from "@/modules/reporting/ui/screens";
import { canManage } from "@/modules/budgeting/ui";
import type { LineDashboardDto, PeriodDto, ReportPlanDto } from "@/shared/ui/api/dto";
import { useApis } from "../api";
import type { Viewer } from "../load";
import { daysOf, noPeriod, previousPlanReads, windowOf } from "../plan/loaders";
import {
  cashFlowQuery,
  categoriesQuery,
  lineReportQuery,
  lineTrendQuery,
  membersQuery,
  overviewQuery,
  personalGroupsQuery,
  personalTrendQuery,
  spaceReportQuery,
} from "../reads";
import { useLabel, useNeighbours } from "../plan/period";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const plan = getRouteApi("/spaces/$spaceId/plan");
const lines = getRouteApi("/spaces/$spaceId/plan/lines");
const groups = getRouteApi("/spaces/$spaceId/plan/groups");
const trend = getRouteApi("/spaces/$spaceId/plan/trend");
const fund = getRouteApi("/spaces/$spaceId/plan/fund");
const members = getRouteApi("/spaces/$spaceId/plan/members");
const calendar = getRouteApi("/spaces/$spaceId/plan/calendar");

/** The Plan tab's frame around a view: its tabs, its period with the way to the neighbouring ones, and its plan. */
function Frame({
  viewer,
  view,
  period,
  plan: framePlan,
  wide = false,
  fundNames,
  children,
}: {
  readonly viewer: Viewer;
  readonly view: FrameView;
  readonly period: PeriodDto;
  readonly plan: ReportPlanDto | null;
  readonly wide?: boolean;
  readonly fundNames?: readonly string[];
  readonly children: ReactNode;
}) {
  const { previous, next } = useNeighbours(viewer.space.id, period);
  return (
    <DashboardFrame
      space={viewer.space}
      view={view}
      wide={wide}
      period={period}
      previous={previous}
      next={next}
      formats={viewer.me.preferences.effective}
      plan={framePlan}
      fundNames={fundNames}
    >
      {children}
    </DashboardFrame>
  );
}

/** What a read gave so far: its answer once it has one, and whether it failed. */
interface ReadState<T> {
  readonly data: T | undefined;
  readonly isError: boolean;
}

/**
 * The previous period when it has a plan to copy, null when it has none, undefined while not known, and `true` when a
 * read failed: the copy is offered anyway, and the API answers with its own message when there is nothing to copy.
 */
const previousPlanOf = (
  period: ReadState<PeriodDto | null>,
  dashboard: ReadState<LineDashboardDto>,
): PeriodDto | true | null | undefined => {
  if (period.isError) return true;
  // No previous period (null) or not known yet (undefined); a dashboard that fails still offers the copy.
  if (!period.data || dashboard.isError) return period.data;
  return dashboard.data && (dashboard.data.plan === null ? null : period.data);
};

/**
 * Ruling P311: whether the period before a period without a plan has a plan to copy (`previousPlanOf`), read only
 * for whoever may create the plan (P207), through the same reads as the loader (`previousPlanReads`).
 */
function usePreviousPlan(viewer: Viewer, dashboard: LineDashboardDto): PeriodDto | true | null | undefined {
  const { api } = useApis();
  const reads = previousPlanReads(api, viewer.space.id, dashboard);
  const wanted = reads.wanted && canManage(viewer.space.role);
  const before = useQuery({ ...reads.period, enabled: wanted });
  const report = useQuery({ ...reads.dashboard(before.data), enabled: wanted && Boolean(before.data) });
  return wanted ? previousPlanOf(before, report) : undefined;
}

/** HU-E9-10: the period's line dashboard, with a shared space's desktop overview when it has a plan (P216). */
function Lines({ viewer, asked }: { readonly viewer: Viewer; readonly asked: string | undefined }) {
  const { api } = useApis();
  const label = useLabel(viewer, asked);
  const dashboard = useSuspenseQuery(lineReportQuery(api, viewer.space.id, label)).data;
  const withOverview = viewer.space.kind !== "PERSONAL" && dashboard.plan !== null;
  const overview = useQuery({ ...overviewQuery(api, viewer.space.id, label), enabled: withOverview }).data;
  // #240: the space's categories name Unbudgeted's; the caption waits for nothing and an older API names none.
  const unbudgetedIds = dashboard.unbudgeted?.categoryIds;
  const categories = useQuery({
    ...categoriesQuery(api, viewer.space.id, "all"),
    enabled: dashboard.plan !== null && (unbudgetedIds?.length ?? 0) > 0,
  }).data;
  const formats = viewer.me.preferences.effective;
  const previous = usePreviousPlan(viewer, dashboard);
  return (
    <Frame
      viewer={viewer}
      view="lines"
      wide={withOverview && overview !== undefined}
      period={dashboard.period}
      plan={dashboard.plan}
    >
      {dashboard.plan === null ? (
        <NoPlan space={viewer.space} dashboard={dashboard} formats={formats} previous={previous} />
      ) : (
        <LineDashboard
          dashboard={dashboard}
          policy={viewer.space.periodPolicy}
          formats={formats}
          unbudgetedNames={unbudgetedNamesOf(unbudgetedIds, categories)}
        />
      )}
      {withOverview && overview ? (
        <DashOverview space={viewer.space} overview={overview} formats={formats} />
      ) : null}
    </Frame>
  );
}

/** Rulings P200 and P267: the Plan tab's own page is Lines in every space, the personal one included. */
export function PlanRoute() {
  useTitle(useTranslations("reports")("title"));
  const viewer = useViewer(plan.useParams().spaceId);
  return <Lines viewer={viewer} asked={plan.useSearch().period} />;
}

/** HU-E9-11: the Lines view, the personal space's second view. */
export function LinesRoute() {
  useTitle(useTranslations("reports.view")("lines"));
  const viewer = useViewer(lines.useParams().spaceId);
  return <Lines viewer={viewer} asked={lines.useSearch().period} />;
}

/** HU-E9-10, HU-E9-11: spending by group, the person's own in the personal space (P200, P215). */
export function GroupsRoute() {
  useTitle(useTranslations("reports.view")("groups"));
  const viewer = useViewer(groups.useParams().spaceId);
  const label = useLabel(viewer, groups.useSearch().period);
  return viewer.space.kind === "PERSONAL" ? (
    <PersonalGroups viewer={viewer} label={label} />
  ) : (
    <SpaceGroups viewer={viewer} label={label} />
  );
}

/** The chart of either report: the same tree of groups with their total. */
function GroupsChart({
  viewer,
  report,
  note,
}: {
  readonly viewer: Viewer;
  readonly report: {
    readonly period: PeriodDto;
    readonly groups: Parameters<typeof treeOf>[0];
    readonly total: ComponentProps<typeof SpendingChart>["total"];
  };
  readonly note: string;
}) {
  return (
    <Frame viewer={viewer} view="groups" period={report.period} plan={null}>
      <SpendingChart
        tree={treeOf(report.groups)}
        total={report.total}
        formats={viewer.me.preferences.effective}
        note={note}
        personal={viewer.space.kind === "PERSONAL"}
      />
    </Frame>
  );
}

function PersonalGroups({ viewer, label }: { readonly viewer: Viewer; readonly label: string }) {
  const { api } = useApis();
  const t = useTranslations("reports");
  const report = useSuspenseQuery(personalGroupsQuery(api, viewer.space.id, label)).data;
  return <GroupsChart viewer={viewer} report={report} note={t("byGroup.personalNote")} />;
}

function SpaceGroups({ viewer, label }: { readonly viewer: Viewer; readonly label: string }) {
  const { api } = useApis();
  const t = useTranslations("reports");
  const report = useSuspenseQuery(spaceReportQuery(api, viewer.space.id, "spending-by-group", label)).data;
  return <GroupsChart viewer={viewer} report={report} note={t("byGroup.spaceNote")} />;
}

/** HU-E9-11: the trend, the person's own consumption in the personal space and every plan line's in a shared one. */
export function TrendRoute() {
  useTitle(useTranslations("reports.view")("trend"));
  const viewer = useViewer(trend.useParams().spaceId);
  const search = trend.useSearch();
  const label = useLabel(viewer, search.period);
  const periods = windowOf(search.periods);
  return viewer.space.kind === "PERSONAL" ? (
    <PersonalTrendView viewer={viewer} label={label} periods={periods} />
  ) : (
    <LineTrendView viewer={viewer} label={label} periods={periods} />
  );
}

function PersonalTrendView({
  viewer,
  label,
  periods,
}: {
  readonly viewer: Viewer;
  readonly label: string;
  readonly periods: 6 | 12;
}) {
  const { api } = useApis();
  const data = useSuspenseQuery(personalTrendQuery(api, viewer.space.id, label, periods)).data;
  const last = data.periods.at(-1);
  if (!last) throw noPeriod();
  return (
    <Frame viewer={viewer} view="trend" period={last} plan={null}>
      <PersonalTrend
        space={viewer.space}
        trend={data}
        formats={viewer.me.preferences.effective}
        periods={periods}
      />
    </Frame>
  );
}

function LineTrendView({
  viewer,
  label,
  periods,
}: {
  readonly viewer: Viewer;
  readonly label: string;
  readonly periods: 6 | 12;
}) {
  const { api } = useApis();
  const data = useSuspenseQuery(lineTrendQuery(api, viewer.space.id, label, periods)).data;
  const last = data.periods.at(-1);
  if (!last) throw noPeriod();
  return (
    <Frame viewer={viewer} view="trend" period={last} plan={data.plan}>
      {/* Board E9-11 04 (ruling P272): each line against the previous period, so it offers no window of its own. */}
      <LineTrend space={viewer.space} trend={data} formats={viewer.me.preferences.effective} />
    </Frame>
  );
}

/** HU-E9-10: what each member put into the shared fund in the period. */
export function FundRoute() {
  useTitle(useTranslations("reports.view")("fund"));
  const viewer = useViewer(fund.useParams().spaceId);
  const { api } = useApis();
  const label = useLabel(viewer, fund.useSearch().period);
  const [report, list] = useSuspenseQueries({
    queries: [
      spaceReportQuery(api, viewer.space.id, "fund-contributions", label),
      membersQuery(api, viewer.space.id),
    ],
  });
  return (
    <Frame
      viewer={viewer}
      view="fund"
      period={report.data.period}
      plan={report.data.plan}
      fundNames={report.data.funds?.map((account) => account.name)}
    >
      <FundTracking
        fund={report.data}
        members={list.data}
        space={viewer.space}
        formats={viewer.me.preferences.effective}
      />
    </Frame>
  );
}

/** HU-E9-10: the member matrix of the period. */
export function MembersMatrixRoute() {
  useTitle(useTranslations("reports")("view.members"));
  const viewer = useViewer(members.useParams().spaceId);
  const { api } = useApis();
  const label = useLabel(viewer, members.useSearch().period);
  const [matrix, list] = useSuspenseQueries({
    queries: [
      spaceReportQuery(api, viewer.space.id, "member-matrix", label),
      membersQuery(api, viewer.space.id),
    ],
  });
  return (
    <Frame viewer={viewer} view="members" period={matrix.data.period} plan={matrix.data.plan}>
      <MemberMatrix
        space={viewer.space}
        matrix={matrix.data}
        members={list.data}
        formats={viewer.me.preferences.effective}
      />
    </Frame>
  );
}

/** #150: what comes in and goes out over the next 30 or 60 days, the personal space's Próximos (P241 of M6c). */
export function CalendarRoute() {
  useTitle(useTranslations("reports")("calendar.metaTitle"));
  const viewer = useViewer(calendar.useParams().spaceId);
  const { api } = useApis();
  const flow = useSuspenseQuery(cashFlowQuery(api, viewer.space.id, daysOf(calendar.useSearch().days))).data;
  return <LazyCashFlowCalendar space={viewer.space} flow={flow} formats={viewer.me.preferences.effective} />;
}
