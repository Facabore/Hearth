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
  const periods = periodsFrom(input.from);
  const neighbour = async (from: string) => {
    const result = await periodsFrom(from);
    return result.ok ? (result.data.items[0] ?? null) : null;
  };
  // Issue #196: the movements and the neighbours need only the period, so they never wait for the members.
  const rest = periods.then((found) => {
    const period = found.ok ? found.data.items[0] : undefined;
    return period
      ? Promise.all([
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
        ])
      : null;
  });
  // A failed read below returns first and leaves these unawaited: never an unhandled rejection.
  void rest.catch(() => undefined);
  const [found, members] = await Promise.all([
    periods,
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })),
  ]);
  if (!found.ok) return found;
  if (!members.ok) return members;
  const period = found.data.items[0];
  if (!period) throw new Error("The API answered no period");
  const [history, previous, next] = (await rest)!;
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
  // A personal space has no balances: the reads wait for that check, never for the person (issue #196).
  const spaceRead = getSpaces().then((spaces) => {
    const space = spaces.find((s) => s.id === spaceId);
    return !space || space.kind === "PERSONAL" ? notFound() : space;
  });
  const read = Promise.all([serverApi(), spaceRead]).then(([api]) =>
    loadBalanceHistory(api, { spaceId, memberId, from }),
  );
  void read.catch(() => undefined);
  const [me, space] = await Promise.all([getMe(), spaceRead]);
  const result = await read;
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
