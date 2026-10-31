import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { PlanView as FrameView } from "@/modules/reporting/ui";
import {
  CashFlowCalendar,
  DashboardFrame,
  DashOverview,
  FundTracking,
  LineDashboard,
  LineTrend,
  MemberMatrix,
  NoPlan,
  PersonalTrend,
  SpendingChart,
  treeOf,
} from "@/modules/reporting/ui/screens";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { PeriodDto, ReportPlanDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import type { Viewer } from "../load";
import { daysOf, noPeriod, windowOf } from "../plan/loaders";
import {
  cashFlowQuery,
  lineReportQuery,
  lineTrendQuery,
  membersQuery,
  overviewQuery,
  periodQuery,
  personalGroupsQuery,
  personalTrendQuery,
  spaceReportQuery,
} from "../reads";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const plan = getRouteApi("/spaces/$spaceId/plan");
const lines = getRouteApi("/spaces/$spaceId/plan/lines");
const groups = getRouteApi("/spaces/$spaceId/plan/groups");
const trend = getRouteApi("/spaces/$spaceId/plan/trend");
const fund = getRouteApi("/spaces/$spaceId/plan/fund");
const members = getRouteApi("/spaces/$spaceId/plan/members");
const calendar = getRouteApi("/spaces/$spaceId/plan/calendar");

/** Ruling P205: the period asked for, else the one holding today in the person's zone, read as the loader did. */
const useLabel = (viewer: Viewer, asked: string | undefined): string => {
  const { api } = useApis();
  const today = nowIn(new Date(), viewer.me.timezone).date;
  // Read only when no period is asked for; hooks are called the same way on every render.
  const queries: ReturnType<typeof periodQuery>[] = asked ? [] : [periodQuery(api, viewer.space.id, today)];
  const [held] = useSuspenseQueries({ queries });
  const label = asked ?? held?.data?.label;
  if (!label) throw noPeriod();
  return label;
};

/** The periods before and after the view's (P130); one that fails is just absent. */
const useNeighbours = (spaceId: string, period: PeriodDto) => {
  const { api } = useApis();
  const previous = useQuery(periodQuery(api, spaceId, addDays(period.startDate as LocalDate, -1))).data;
  const next = useQuery(periodQuery(api, spaceId, addDays(period.endDate as LocalDate, 1))).data;
  return { previous: previous ?? null, next: next ?? null };
};

/** The Plan tab's frame around a view: its tabs, its period with the way to the neighbouring ones, and its plan. */
function Frame({
  viewer,
  view,
  period,
  plan: framePlan,
  wide = false,
  children,
}: {
  readonly viewer: Viewer;
  readonly view: FrameView;
  readonly period: PeriodDto;
  readonly plan: ReportPlanDto | null;
  readonly wide?: boolean;
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
    >
      {children}
    </DashboardFrame>
  );
}

/** HU-E9-10: the period's line dashboard, with a shared space's desktop overview when it has a plan (P216). */
function Lines({ viewer, asked }: { readonly viewer: Viewer; readonly asked: string | undefined }) {
  const { api } = useApis();
  const label = useLabel(viewer, asked);
  const dashboard = useSuspenseQuery(lineReportQuery(api, viewer.space.id, label)).data;
  const withOverview = viewer.space.kind !== "PERSONAL" && dashboard.plan !== null;
  const overview = useQuery({ ...overviewQuery(api, viewer.space.id, label), enabled: withOverview }).data;
  const formats = viewer.me.preferences.effective;
  return (
    <Frame
      viewer={viewer}
      view="lines"
      wide={withOverview && overview !== undefined}
      period={dashboard.period}
      plan={dashboard.plan}
    >
      {dashboard.plan === null ? (
        <NoPlan space={viewer.space} dashboard={dashboard} formats={formats} />
      ) : (
        <LineDashboard dashboard={dashboard} policy={viewer.space.periodPolicy} formats={formats} />
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
      <LineTrend
        space={viewer.space}
        trend={data}
        formats={viewer.me.preferences.effective}
        periods={periods}
      />
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
    <Frame viewer={viewer} view="fund" period={report.data.period} plan={report.data.plan}>
      <FundTracking fund={report.data} members={list.data} formats={viewer.me.preferences.effective} />
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
  return <CashFlowCalendar space={viewer.space} flow={flow} formats={viewer.me.preferences.effective} />;
}
