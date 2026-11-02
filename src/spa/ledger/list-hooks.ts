import { queryOptions, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import type { ListFilter } from "@/modules/ledger/ui";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import {
  accountsQuery,
  categoriesQuery,
  LOADER_OWNED,
  membersQuery,
  netBalancesQuery,
  periodQuery,
} from "../reads";
import { sharedSpace, type Viewer } from "../load";
import { read } from "../read";
import { movedOf, rowContextOf } from "./hooks";
import { listQueryOf, pageQuery } from "./queries";

/**
 * Movimientos' own hooks, apart from `hooks.ts`: Inicio loads that module too, and the list's filters and period chip
 * are no part of its chunk (ADR 0004).
 */

/** Ruling P277: the period chip's sheet reads 24 periods from about eleven months before today. */
const RECENT_PERIODS = 24;
const RECENT_DAYS = 330;

/**
 * Ruling P277: the space's periods from about a year back, for Movimientos' period chip: a monthly space's last twelve
 * and the coming ones, a semi-monthly one's last 22 halves and the coming ones; the sheet keeps those up to today.
 */
export const recentPeriodsQuery = (api: Api, spaceId: string, today: string) =>
  queryOptions<readonly PeriodDto[]>({
    ...LOADER_OWNED,
    queryKey: ["ledger", spaceId, "periods", today] as const,
    queryFn: async () =>
      (
        await read(
          api.GET("/api/v1/spaces/{spaceId}/periods", {
            params: {
              path: { spaceId },
              query: { from: addDays(today as LocalDate, -RECENT_DAYS), count: RECENT_PERIODS },
            },
          }),
        )
      ).items,
  });

export const useList = (viewer: Viewer, filter: ListFilter) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const shared = sharedSpace(viewer.space);
  const [page, groups, accounts] = useSuspenseQueries({
    queries: [
      pageQuery(api, spaceId, listQueryOf(filter)),
      categoriesQuery(api, spaceId, "all"),
      accountsQuery(api, spaceId, "all"),
    ],
  });
  // Hooks are called the same way on every render: the members are an empty list of queries outside a shared space.
  const memberQueries: ReturnType<typeof membersQuery>[] = shared ? [membersQuery(api, spaceId)] : [];
  const members = useSuspenseQueries({ queries: memberQueries });
  // #217 (P263): the payer filter leaves out members no movement touched. The balances are optional: until they are
  // read, or when they cannot be, every member is offered.
  const balances = useQuery({ ...netBalancesQuery(api, spaceId), enabled: shared });
  const { period } = page.data;
  const previous = useQuery(periodQuery(api, spaceId, addDays(period.startDate as LocalDate, -1)));
  const next = useQuery(periodQuery(api, spaceId, addDays(period.endDate as LocalDate, 1)));
  // Ruling P277: the period chip's choices; its sheet offers the neighbours until they are read, or when they cannot be.
  const periods = useQuery(recentPeriodsQuery(api, spaceId, nowIn(new Date(), viewer.me.timezone).date));
  const memberNames = Object.fromEntries((members[0]?.data ?? []).map((m) => [m.id, m.displayName]));
  return {
    page: page.data,
    accounts: accounts.data,
    context: rowContextOf(viewer.me, groups.data, accounts.data, memberNames),
    previous: previous.data ?? null,
    next: next.data ?? null,
    periods: periods.data,
    movedMemberIds: movedOf(balances.data?.members),
  };
};
