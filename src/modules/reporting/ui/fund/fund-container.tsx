import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { FundTrackingDto, MemberDto, PeriodDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { FundTracking } from "./fund-tracking";

/** HU-E9-10: the period's fund report, the space's members and the neighbouring periods (ruling P205). */
export const loadFund = async (
  api: Api,
  input: { spaceId: string; period?: string; today: string },
): Promise<
  Loaded<{ fund: FundTrackingDto; members: MemberDto[]; previous: PeriodDto | null; next: PeriodDto | null }>
> => {
  const label = await periodLabel(api, input.spaceId, input.period, input.today);
  if (!label.ok) return label;
  const path = { path: { spaceId: input.spaceId } };
  const [fund, members] = await Promise.all([
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/reports/fund-contributions", {
        params: { ...path, query: { period: label.data } },
      }),
    ),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: path })),
  ]);
  if (!fund.ok) return fund;
  if (!members.ok) return members;
  return {
    ok: true,
    data: {
      fund: fund.data,
      members: members.data.items,
      ...(await neighboursOf(api, input.spaceId, fund.data.period)),
    },
  };
};

/** Server: the Fund view of the Plan tab for `?period=`, in the person's formats; the personal space has none. */
export async function FundTrackingContainer({
  spaceId,
  period,
}: {
  readonly spaceId: string;
  readonly period?: string;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaceOf(spaces, spaceId);
  if (space.kind === "PERSONAL") notFound();
  const result = await loadFund(await serverApi(), {
    spaceId,
    period,
    today: nowIn(serverNow(), me!.timezone).date,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { fund, members, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    <DashboardFrame
      space={space}
      view="fund"
      period={fund.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={fund.plan}
    >
      <FundTracking fund={fund} members={members} formats={formats} />
    </DashboardFrame>
  );
}
