import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { LineDashboardDto, PeriodDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { LineDashboard } from "./line-dashboard";

/** HU-E9-10: the period's line dashboard and its neighbouring periods (ruling P205). */
export const loadLines = async (
  api: Api,
  input: { spaceId: string; period?: string; today: string },
): Promise<Loaded<{ dashboard: LineDashboardDto; previous: PeriodDto | null; next: PeriodDto | null }>> => {
  const label = await periodLabel(api, input.spaceId, input.period, input.today);
  if (!label.ok) return label;
  const dashboard = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/reports/lines", {
      params: { path: { spaceId: input.spaceId }, query: { period: label.data } },
    }),
  );
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
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaceOf(spaces, spaceId);
  const result = await loadLines(await serverApi(), {
    spaceId,
    period,
    today: nowIn(serverNow(), me!.timezone).date,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { dashboard, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    <DashboardFrame
      space={space}
      view="lines"
      period={dashboard.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={dashboard.plan}
    >
      <LineDashboard dashboard={dashboard} formats={formats} />
    </DashboardFrame>
  );
}
