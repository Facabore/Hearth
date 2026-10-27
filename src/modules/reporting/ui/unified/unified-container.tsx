import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, ReportPlanDto, UnifiedViewDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { UnifiedView } from "./unified-view";

/**
 * The period's plan of the personal space, as its line dashboard names it: null when the period has none, undefined
 * when it cannot be read. It never stands in the way of the view.
 */
const planOf = async (
  api: Api,
  spaceId: string,
  period: string,
): Promise<ReportPlanDto | null | undefined> => {
  try {
    const { data } = await api.GET("/api/v1/spaces/{spaceId}/reports/lines", {
      params: { path: { spaceId }, query: { period } },
    });
    return data?.plan;
  } catch {
    return undefined;
  }
};

/**
 * HU-E9-11: the caller's own unified view of the personal space's period (D11, ruling P205), the personal space's
 * neighbouring periods, and the period's plan: the personal Plan tab opens here, so it leads to the plan (owner,
 * 2026-10-22).
 */
export const loadUnified = async (
  api: Api,
  input: {
    spaceId: string;
    period?: string;
    /** Today in the person's zone; it names the period only when none is asked for, so it may still be arriving. */
    today: string | PromiseLike<string>;
  },
): Promise<
  Loaded<{
    view: UnifiedViewDto;
    plan: ReportPlanDto | null | undefined;
    previous: PeriodDto | null;
    next: PeriodDto | null;
  }>
> => {
  // An asked period never waits for the person: only today's period needs their zone (issue #196).
  const label = await periodLabel(api, input.spaceId, input.period, input.period ? "" : await input.today);
  if (!label.ok) return label;
  const [view, plan] = await Promise.all([
    loaded(api.GET("/api/v1/me/unified-view", { params: { query: { period: label.data } } })),
    planOf(api, input.spaceId, label.data),
  ]);
  if (!view.ok) return view;
  return {
    ok: true,
    data: { view: view.data, plan, ...(await neighboursOf(api, input.spaceId, view.data.period)) },
  };
};

/** Server: My spending, the personal space's Plan tab, for `?period=`, in the person's formats. */
export async function UnifiedViewContainer({
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
  const read = Promise.all([serverApi(), spaceRead]).then(([api]) =>
    loadUnified(api, { spaceId, period, today }),
  );
  void read.catch(() => undefined);
  const [me, space] = await Promise.all([meRead, spaceRead]);
  const result = await read;
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { view, plan, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    // The period's plan with its planner link, or the way to plan it; neither when the plan could not be read.
    <DashboardFrame
      space={space}
      view="mine"
      period={view.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={plan ?? null}
      offerPlanStart={plan === null}
    >
      <UnifiedView view={view} formats={formats} />
    </DashboardFrame>
  );
}
