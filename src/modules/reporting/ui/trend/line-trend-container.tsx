import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { LineTrendDto, PeriodDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { LineTrend } from "./line-trend";

/**
 * HU-E9-11: every line of the end period's plan over the window ending in the space's period (ruling P205), and the
 * neighbours of that last period.
 */
export const loadLineTrend = async (
  api: Api,
  input: { spaceId: string; period?: string; periods: 6 | 12; today: string },
): Promise<
  Loaded<{ trend: LineTrendDto; period: PeriodDto; previous: PeriodDto | null; next: PeriodDto | null }>
> => {
  const label = await periodLabel(api, input.spaceId, input.period, input.today);
  if (!label.ok) return label;
  const trend = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/reports/trend", {
      params: { path: { spaceId: input.spaceId }, query: { endPeriod: label.data, periods: input.periods } },
    }),
  );
  if (!trend.ok) return trend;
  const period = trend.data.periods.at(-1);
  if (!period) {
    return { ok: false, problem: { code: "Unknown", status: 200, requestId: null, errors: [], field: null } };
  }
  return {
    ok: true,
    data: { trend: trend.data, period, ...(await neighboursOf(api, input.spaceId, period)) },
  };
};

/** Server: the Trend view of a shared space's Plan tab for `?period=` and `?periods=`, in the person's formats. */
export async function LineTrendContainer({
  spaceId,
  period,
  periods,
}: {
  readonly spaceId: string;
  readonly period?: string;
  readonly periods: 6 | 12;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaceOf(spaces, spaceId);
  const result = await loadLineTrend(await serverApi(), {
    spaceId,
    period,
    periods,
    today: nowIn(serverNow(), me!.timezone).date,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { trend, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    <DashboardFrame
      space={space}
      view="trend"
      period={result.data.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={trend.plan}
    >
      <LineTrend space={space} trend={trend} formats={formats} periods={periods} />
    </DashboardFrame>
  );
}
