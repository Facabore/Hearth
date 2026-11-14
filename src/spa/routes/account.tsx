import { useQueries, useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { AccountScreen, AccountStatistics, canManageAccounts } from "@/modules/accounts/ui";
import {
  FundMovements,
  PersonalAccountMovements,
  TransactionSheetHost,
  type AccountView,
} from "@/modules/ledger/ui";
import { personalSpaceOf } from "@/modules/spaces/ui";
import type { PeriodDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { accountReportQuery, movementsQueryOf } from "../accounts/screen";
import { useApis } from "../api";
import { memberNamesOf, rowContextOf, useTransactionDetail, viewerMemberIdOf } from "../ledger/hooks";
import { myPageQuery, neighboursOf, pageQuery } from "../ledger/queries";
import { sharedSpace } from "../load";
import { accountQuery, accountsQuery, categoriesQuery, membersQuery } from "../reads";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/accounts/$accountId");

/**
 * Ruling P327 (#315): an account's own screen from the query cache (ADR 0006): its movements (`?view=` absent) or its
 * statistics (`?view=stats`) in the period `?period=` names, today's by default; `?tx=` opens a row's detail over it.
 */
export function AccountRoute() {
  const { spaceId, accountId } = route.useParams();
  const { period: asked, view = "movements", tx } = route.useSearch();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const { me, space, spaces } = viewer;
  const account = useSuspenseQuery(accountQuery(api, spaceId, accountId)).data;
  useTitle(account.name);
  const personal = space.kind === "PERSONAL";
  const shared = sharedSpace(space);
  const query = movementsQueryOf(asked, accountId);
  // The hooks run the same way on every render: each kind of page is an empty list of queries for the other kind.
  const myQueries: ReturnType<typeof myPageQuery>[] = personal ? [myPageQuery(api, spaceId, query)] : [];
  const spaceQueries: ReturnType<typeof pageQuery>[] = personal ? [] : [pageQuery(api, spaceId, query)];
  const memberQueries: ReturnType<typeof membersQuery>[] = shared ? [membersQuery(api, spaceId)] : [];
  const [mine] = useSuspenseQueries({ queries: myQueries });
  const [theirs] = useSuspenseQueries({ queries: spaceQueries });
  const [members] = useSuspenseQueries({ queries: memberQueries });
  const [groups, accounts] = useSuspenseQueries({
    queries: [categoriesQuery(api, spaceId, "all"), accountsQuery(api, spaceId, "all")],
  });
  const own = useQuery({ ...accountsQuery(api, personalSpaceOf(spaces).id, "all"), enabled: shared });
  const period = (mine?.data ?? theirs?.data)!.period;
  const report = useQuery(accountReportQuery(api, space, accountId, period.label)).data;
  const [previous, next] = useQueries({ queries: neighboursOf(api, spaceId, period) });
  const detail = useTransactionDetail(viewer, tx);

  const today = nowIn(new Date(), me.timezone).date;
  const holdsToday = (p: Pick<PeriodDto, "startDate" | "endDate">) =>
    p.startDate <= today && today <= p.endDate;
  const base = `/spaces/${spaceId}/accounts/${accountId}`;
  // The current period is the plain address, as the API answers it; a view other than Movimientos is in the address.
  const hrefOf = (p: PeriodDto, v: string) => {
    const search = new URLSearchParams();
    if (!holdsToday(p)) search.set("period", p.label);
    if (v === "stats") search.set("view", v);
    const text = search.toString();
    return text ? `${base}?${text}` : base;
  };
  const here = hrefOf(period, view);
  const context = rowContextOf(
    me,
    groups.data,
    accounts.data,
    memberNamesOf(members?.data ?? []),
    viewerMemberIdOf(me, members?.data ?? []),
  );
  const look: AccountView = {
    id: accountId,
    fund: account.type === "SHARED_FUND",
    ...(shared ? { ownAccountNames: Object.fromEntries((own.data ?? []).map((a) => [a.id, a.name])) } : {}),
  };
  const common = { context, today, account: look, href: here, period: period.label, api };
  return (
    <>
      <AccountScreen
        spaceId={spaceId}
        account={account}
        // Ruling P327: Configurar opens today's edit form, only for whoever may manage the account.
        editHref={
          canManageAccounts(space.kind, space.role) && account.archivedAt === null
            ? `${base}/edit`
            : undefined
        }
        view={view}
        movementsHref={hrefOf(period, "movements")}
        statsHref={hrefOf(period, "stats")}
        period={period}
        policy={space.periodPolicy}
        previousHref={previous?.data ? hrefOf(previous.data, view) : undefined}
        nextHref={!holdsToday(period) && next?.data ? hrefOf(next.data, view) : undefined}
        figures={
          report?.account
            ? {
                in: report.account.in,
                out: report.account.out,
                spent: report.total,
                movedToOwnAccounts: report.account.movedToOwnAccounts,
              }
            : null
        }
        formats={me.preferences.effective}
      >
        {view === "stats" ? (
          report ? (
            <AccountStatistics
              groups={report.groups}
              looks={groups.data}
              formats={me.preferences.effective}
            />
          ) : null
        ) : mine ? (
          <PersonalAccountMovements page={mine.data} {...common} />
        ) : theirs ? (
          <FundMovements spaceId={spaceId} page={theirs.data} {...common} />
        ) : null}
      </AccountScreen>
      {detail ? (
        <TransactionSheetHost spaceId={spaceId} detail={detail} context={context} origin={here} api={api} />
      ) : null}
    </>
  );
}
