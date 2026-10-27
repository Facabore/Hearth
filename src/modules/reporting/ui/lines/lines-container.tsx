import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { LineDashboardDto, PeriodDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { DashOverview } from "../overview/dash-overview";
import { loadOverview } from "../overview/overview-container";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { LineDashboard } from "./line-dashboard";
import { NoPlan } from "./no-plan";

/** HU-E9-10: the period's line dashboard, read for `?period=` or today's period (ruling P205). */
const loadDashboard = async (
  api: Api,
  input: { spaceId: string; period?: string; today: string | PromiseLike<string> },
): Promise<Loaded<LineDashboardDto>> => {
  // An asked period never waits for the person: only today's period needs their zone (issue #196).
  const label = await periodLabel(api, input.spaceId, input.period, input.period ? "" : await input.today);
  if (!label.ok) return label;
  return loaded(
    api.GET("/api/v1/spaces/{spaceId}/reports/lines", {
      params: { path: { spaceId: input.spaceId }, query: { period: label.data } },
    }),
  );
};

/** HU-E9-10: the period's line dashboard and its neighbouring periods (ruling P205). */
export const loadLines = async (
  api: Api,
  input: {
    spaceId: string;
    period?: string;
    /** Today in the person's zone; it names the period only when none is asked for, so it may still be arriving. */
    today: string | PromiseLike<string>;
  },
): Promise<Loaded<{ dashboard: LineDashboardDto; previous: PeriodDto | null; next: PeriodDto | null }>> => {
  const dashboard = await loadDashboard(api, input);
  if (!dashboard.ok) return dashboard;
  return {
    ok: true,
    data: { dashboard: dashboard.data, ...(await neighboursOf(api, input.spaceId, dashboard.data.period)) },
  };
};

/** Server: the Lines view of the Plan tab for `?period=`, in the person's formats. */
export async function LineDashboardContainer({
  spaceId,
  period,
}: {
  readonly spaceId: string;
  readonly period?: string;
}) {
  const meRead = getMe();
  const today = meRead.then((me) => nowIn(serverNow(), me!.timezone).date);
  // An asked period leaves today unread; a failed read of the person throws below, never as an unhandled rejection.
  void today.catch(() => undefined);
  // The reads wait for the space check, never for the person: only today's period needs their zone (issue #196).
  const spaceRead = getSpaces().then((spaces) => spaceOf(spaces, spaceId));
  const apiRead = serverApi();
  const dashboardRead = Promise.all([apiRead, spaceRead]).then(([api]) =>
    loadDashboard(api, {
      spaceId,
      period,
      today,
    }),
  );
  // Once the dashboard names the period, its neighbours and (ruling P216) a shared space's desktop overview start
  // together.
  const neighboursRead = Promise.all([apiRead, dashboardRead]).then(([api, dashboard]) =>
    dashboard.ok ? neighboursOf(api, spaceId, dashboard.data.period) : null,
  );
  const overviewRead = Promise.all([apiRead, spaceRead, dashboardRead]).then(([api, space, dashboard]) =>
    dashboard.ok && space.kind !== "PERSONAL" && dashboard.data.plan !== null
      ? loadOverview(api, { spaceId, period: dashboard.data.period.label })
      : null,
  );
  // A failed read below returns first and leaves these unawaited: never an unhandled rejection.
  for (const read of [dashboardRead, neighboursRead, overviewRead]) void read.catch(() => undefined);
  const [me, space] = await Promise.all([meRead, spaceRead]);
  const result = await dashboardRead;
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const dashboard = result.data;
  const { previous, next } = (await neighboursRead)!;
  const formats = me!.preferences.effective;
  const overview = await overviewRead;
  return (
    <DashboardFrame
      space={space}
      view="lines"
      wide={overview !== null}
      period={dashboard.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={dashboard.plan}
    >
      {dashboard.plan === null ? (
        <NoPlan space={space} dashboard={dashboard} formats={formats} />
      ) : (
        <LineDashboard dashboard={dashboard} policy={space.periodPolicy} formats={formats} />
      )}
      {overview ? <DashOverview space={space} overview={overview} formats={formats} /> : null}
    </DashboardFrame>
  );
}
