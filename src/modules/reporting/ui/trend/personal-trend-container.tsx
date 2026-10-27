import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, PersonalTrendDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { PersonalTrend } from "./personal-trend";

/** Ruling P219: the trend's window is six periods, or twelve when `?periods=12` asks for it; anything else is six. */
export const windowOf = (asked: string | undefined): 6 | 12 => (asked === "12" ? 12 : 6);

/**
 * HU-E9-11: the caller's consumption over the window ending in the personal space's period (D11, ruling P205), and
 * the neighbours of that last period.
 */
export const loadPersonalTrend = async (
  api: Api,
  input: {
    spaceId: string;
    period?: string;
    periods: 6 | 12;
    /** Today in the person's zone; it names the period only when none is asked for, so it may still be arriving. */
    today: string | PromiseLike<string>;
  },
): Promise<
  Loaded<{ trend: PersonalTrendDto; period: PeriodDto; previous: PeriodDto | null; next: PeriodDto | null }>
> => {
  // An asked period never waits for the person: only today's period needs their zone (issue #196).
  const label = await periodLabel(api, input.spaceId, input.period, input.period ? "" : await input.today);
  if (!label.ok) return label;
  const trend = await loaded(
    api.GET("/api/v1/me/trend", { params: { query: { endPeriod: label.data, periods: input.periods } } }),
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

/** Server: the Trend view of the personal space's Plan tab for `?period=` and `?periods=`, in the person's formats. */
export async function PersonalTrendContainer({
  spaceId,
  period,
  periods,
}: {
  readonly spaceId: string;
  readonly period?: string;
  readonly periods: 6 | 12;
}) {
  const meRead = getMe();
  const today = meRead.then((me) => nowIn(serverNow(), me!.timezone).date);
  // An asked period leaves today unread; a failed read of the person throws below, never as an unhandled rejection.
  void today.catch(() => undefined);
  // The reads wait for the space check, never for the person: only today's period needs their zone (issue #196).
  const spaceRead = getSpaces().then((spaces) => spaceOf(spaces, spaceId));
  const read = Promise.all([serverApi(), spaceRead]).then(([api]) =>
    loadPersonalTrend(api, {
      spaceId,
      period,
      periods,
      today,
    }),
  );
  void read.catch(() => undefined);
  const [me, space] = await Promise.all([meRead, spaceRead]);
  const result = await read;
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { trend, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    // The personal trend reads no plan, so the frame shows no plan badge or link on this view.
    <DashboardFrame
      space={space}
      view="trend"
      period={result.data.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={null}
    >
      <PersonalTrend space={space} trend={trend} formats={formats} periods={periods} />
    </DashboardFrame>
  );
}
