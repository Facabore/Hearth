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
  input: {
    spaceId: string;
    period?: string;
    /** Today in the person's zone; it names the period only when none is asked for, so it may still be arriving. */
    today: string | PromiseLike<string>;
  },
): Promise<
  Loaded<{ fund: FundTrackingDto; members: MemberDto[]; previous: PeriodDto | null; next: PeriodDto | null }>
> => {
  const path = { path: { spaceId: input.spaceId } };
  // Issue #196: the members need no period, so they start with its lookup.
  const membersRead = loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: path }));
  void membersRead.catch(() => undefined);
  // An asked period never waits for the person: only today's period needs their zone (issue #196).
  const label = await periodLabel(api, input.spaceId, input.period, input.period ? "" : await input.today);
  if (!label.ok) return label;
  const [fund, members] = await Promise.all([
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/reports/fund-contributions", {
        params: { ...path, query: { period: label.data } },
      }),
    ),
    membersRead,
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
  const meRead = getMe();
  const today = meRead.then((me) => nowIn(serverNow(), me!.timezone).date);
  // An asked period leaves today unread; a failed read of the person throws below, never as an unhandled rejection.
  void today.catch(() => undefined);
  // The personal space has none: the reads wait for that check, never for the person (issue #196).
  const spaceRead = getSpaces().then((spaces) => {
    const space = spaceOf(spaces, spaceId);
    if (space.kind === "PERSONAL") notFound();
    return space;
  });
  const read = Promise.all([serverApi(), spaceRead]).then(([api]) =>
    loadFund(api, { spaceId, period, today }),
  );
  void read.catch(() => undefined);
  const [me, space] = await Promise.all([meRead, spaceRead]);
  const result = await read;
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
