import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, UnifiedViewDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { UnifiedView } from "./unified-view";

/**
 * HU-E9-11: the caller's own unified view of the personal space's period (D11, ruling P205) and the personal space's
 * neighbouring periods.
 */
export const loadUnified = async (
  api: Api,
  input: { spaceId: string; period?: string; today: string },
): Promise<Loaded<{ view: UnifiedViewDto; previous: PeriodDto | null; next: PeriodDto | null }>> => {
  const label = await periodLabel(api, input.spaceId, input.period, input.today);
  if (!label.ok) return label;
  const view = await loaded(
    api.GET("/api/v1/me/unified-view", { params: { query: { period: label.data } } }),
  );
  if (!view.ok) return view;
  return {
    ok: true,
    data: { view: view.data, ...(await neighboursOf(api, input.spaceId, view.data.period)) },
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
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaceOf(spaces, spaceId);
  const result = await loadUnified(await serverApi(), {
    spaceId,
    period,
    today: nowIn(serverNow(), me!.timezone).date,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { view, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    // The unified view reads no plan, so the frame shows no plan badge or link on this view.
    <DashboardFrame
      space={space}
      view="mine"
      period={view.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={null}
    >
      <UnifiedView view={view} formats={formats} />
    </DashboardFrame>
  );
}
