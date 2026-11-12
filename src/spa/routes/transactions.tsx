import { getRouteApi } from "@tanstack/react-router";
import { useDeferredValue, useMemo } from "react";
import { useTranslations } from "use-intl";
import { TransactionList } from "@/modules/ledger/ui";
import { nowIn } from "@/shared/ui/time/when";
import { EverySpaceScreen } from "../ledger/every-space-screen";
import { useViewer } from "../ledger/hooks";
import { useList } from "../ledger/list-hooks";
import { ListDetail, useListState, type ListScreenProps } from "../ledger/list-screen";
import { listFilterOf } from "../ledger/list-search";
import { showsUnifiedMonth } from "../load";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/transactions");

/**
 * HU-E9-03: Movimientos from the query cache (ADR 0006), `?period=`, `?category=` and `?payer=` (#148), `?acct=`,
 * `?type=` and `?q=` (P277); `?tx=<id>` opens a row's detail sheet over it (P189), and
 * `?notice=FundBalanceNegative&account=` follows a save that left a shared fund negative (P170). Ruling P319: the
 * personal Movimientos of someone with other spaces lists them all, narrowed to one by `?space=`.
 */
export function TransactionsScreen() {
  useTitle(useTranslations("ledger.list")("title"));
  const { spaceId } = route.useParams();
  const search = route.useSearch();
  const viewer = useViewer(spaceId);
  const every = showsUnifiedMonth(viewer);
  const { spaces } = viewer;
  // P277: a new filter reads in the background while the list it narrows stays on screen, search field and focus
  // included; the router's search is structurally shared, so an unchanged address keeps the same filter. Only the
  // personal list of every space takes `?space=`, and only one of the person's current spaces.
  const filter = useDeferredValue(
    useMemo(() => {
      const { spaceId: chosen, ...rest } = listFilterOf(search);
      return every && chosen !== undefined && spaces.some((s) => s.id === chosen)
        ? { ...rest, spaceId: chosen }
        : rest;
    }, [search, every, spaces]),
  );
  // Each list's reads are hooks of their own: a screen keeps one of them for as long as it stays.
  return every ? (
    <EverySpaceScreen viewer={viewer} filter={filter} search={search} />
  ) : (
    <SpaceScreen viewer={viewer} filter={filter} search={search} />
  );
}

/** A space's own Movimientos: a shared or direct one, or the personal one of someone with no other space. */
function SpaceScreen({ viewer, filter, search }: ListScreenProps) {
  const { page, accounts, context, previous, next, periods, movedMemberIds } = useList(viewer, filter);
  const { me, space } = viewer;
  const { written, pendingNames, fund } = useListState(viewer, search, accounts);
  return (
    <>
      <TransactionList
        key={written}
        spaceId={space.id}
        page={page}
        context={context}
        today={nowIn(new Date(), me.timezone).date}
        filter={filter}
        {...(fund ? { notice: { accountName: fund.name, balance: fund.balance } } : {})}
        {...(space.kind !== "PERSONAL" ? { spaceName: space.name } : {})}
        periodPolicy={space.periodPolicy}
        previous={previous}
        next={next}
        periods={periods}
        accounts={accounts}
        movedMemberIds={movedMemberIds}
        pendingCount={pendingNames.length}
        pendingNames={pendingNames}
      />
      <ListDetail viewer={viewer} filter={filter} context={context} tx={search.tx} />
    </>
  );
}
