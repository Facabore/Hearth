import { notFound } from "next/navigation";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { BalanceHistoryDto, MemberDto, PeriodDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { BalanceHistory } from "./balance-history";

/**
 * HU-E9-07, ruling P176: the period of the space that holds `from` (the current one without it), the member among the
 * current ones, the member's movements within the period and the neighbouring periods, found like the transaction
 * list does, from the day before the start and the day after the end (P130). A neighbour that fails is just absent.
 */
export const loadBalanceHistory = async (
  api: Api,
  input: { spaceId: string; memberId: string; from?: string },
): Promise<
  Loaded<{
    member: MemberDto | null;
    period: PeriodDto;
    previous: PeriodDto | null;
    next: PeriodDto | null;
    history: BalanceHistoryDto;
  }>
> => {
  const path = { spaceId: input.spaceId };
  const periodsFrom = (from: string | undefined) =>
    loaded(api.GET("/api/v1/spaces/{spaceId}/periods", { params: { path, query: { from, count: 1 } } }));
  const [periods, members] = await Promise.all([
    periodsFrom(input.from),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })),
  ]);
  if (!periods.ok) return periods;
  if (!members.ok) return members;
  const period = periods.data.items[0];
  if (!period) throw new Error("The API answered no period");
  const neighbour = async (from: string) => {
    const result = await periodsFrom(from);
    return result.ok ? (result.data.items[0] ?? null) : null;
  };
  const [history, previous, next] = await Promise.all([
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/members/{memberId}/balance-history", {
        params: {
          path: { spaceId: input.spaceId, memberId: input.memberId },
          query: { from: period.startDate, to: period.endDate },
        },
      }),
    ),
    neighbour(addDays(period.startDate as LocalDate, -1)),
    neighbour(addDays(period.endDate as LocalDate, 1)),
  ]);
  if (!history.ok) return history;
  return {
    ok: true,
    data: {
      member: members.data.items.find((member) => member.id === input.memberId) ?? null,
      period,
      previous,
      next,
      history: history.data,
    },
  };
};

/** Server: a member's balance history for `?from=`, in the person's formats; one who is not a current member is a 404. */
export async function HistoryContainer({
  spaceId,
  memberId,
  from,
}: {
  readonly spaceId: string;
  readonly memberId: string;
  readonly from?: string;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space || space.kind === "PERSONAL") notFound();
  const result = await loadBalanceHistory(await serverApi(), { spaceId, memberId, from });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { member, period, previous, next, history } = result.data;
  if (!member) notFound();
  return (
    <BalanceHistory
      spaceId={space.id}
      spaceName={space.name}
      member={member}
      period={period}
      previous={previous}
      next={next}
      history={history}
      formats={me!.preferences.effective}
    />
  );
}
