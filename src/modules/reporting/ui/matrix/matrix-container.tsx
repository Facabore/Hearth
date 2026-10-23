import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { MemberDto, MemberMatrixDto, PeriodDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { MemberMatrix } from "./member-matrix";

/** HU-E9-10: the period's member matrix, the space's members who name its rows and the neighbouring periods. */
export const loadMatrix = async (
  api: Api,
  input: { spaceId: string; period?: string; today: string },
): Promise<
  Loaded<{
    matrix: MemberMatrixDto;
    members: MemberDto[];
    previous: PeriodDto | null;
    next: PeriodDto | null;
  }>
> => {
  const label = await periodLabel(api, input.spaceId, input.period, input.today);
  if (!label.ok) return label;
  const path = { spaceId: input.spaceId };
  const [matrix, members] = await Promise.all([
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/reports/member-matrix", {
        params: { path, query: { period: label.data } },
      }),
    ),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })),
  ]);
  if (!matrix.ok) return matrix;
  if (!members.ok) return members;
  return {
    ok: true,
    data: {
      matrix: matrix.data,
      members: members.data.items,
      ...(await neighboursOf(api, input.spaceId, matrix.data.period)),
    },
  };
};

/** Server: the Members view of the Plan tab for `?period=`, in the person's formats; the personal space has none. */
export async function MemberMatrixContainer({
  spaceId,
  period,
}: {
  readonly spaceId: string;
  readonly period?: string;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaceOf(spaces, spaceId);
  if (space.kind === "PERSONAL") notFound();
  const result = await loadMatrix(await serverApi(), {
    spaceId,
    period,
    today: nowIn(serverNow(), me!.timezone).date,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { matrix, members, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    <DashboardFrame
      space={space}
      view="members"
      period={matrix.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={matrix.plan}
    >
      <MemberMatrix space={space} matrix={matrix} members={members} formats={formats} />
    </DashboardFrame>
  );
}
