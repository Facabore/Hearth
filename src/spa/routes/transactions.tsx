import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useDeferredValue, useMemo } from "react";
import { useTranslations } from "use-intl";
import { TransactionList, TransactionSheetHost, transactionListHref } from "@/modules/ledger/ui";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { useTransactionDetail, useViewer } from "../ledger/hooks";
import { useList } from "../ledger/list-hooks";
import { listFilterOf } from "../ledger/list-search";
import { writesQuery } from "../ledger/queries";
import { usePendingNames } from "../recurring-pending/queries";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/transactions");

/**
 * HU-E9-03: Movimientos from the query cache (ADR 0006), `?period=`, `?category=` and `?payer=` (#148), `?acct=`,
 * `?type=` and `?q=` (P277); `?tx=<id>` opens a row's detail sheet over it (P189), and
 * `?notice=FundBalanceNegative&account=` follows a save that left a shared fund negative (P170).
 */
export function TransactionsScreen() {
  useTitle(useTranslations("ledger.list")("title"));
  const { spaceId } = route.useParams();
  const search = route.useSearch();
  const { notice, account, tx } = search;
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  // P277: a new filter reads in the background while the list it narrows stays on screen, search field and focus
  // included; the router's search is structurally shared, so an unchanged address keeps the same filter.
  const filter = useDeferredValue(useMemo(() => listFilterOf(search), [search]));
  const { page, accounts, context, previous, next, periods, movedMemberIds } = useList(viewer, filter);
  const detail = useTransactionDetail(viewer, tx);
  const { me, space } = viewer;
  // A write starts the list afresh, rows "Cargar más" added included: none of them can show what the write changed.
  const written = useQuery(writesQuery(spaceId)).data;
  // HU-E9-09 (ruling P270): the banner to "Por confirmar", from the read the shell's badge already holds.
  const pendingNames = usePendingNames(space);
  // The balance is the fund's balance now, read with the list: no amount ever travels in the address (P170).
  const fund = notice === "FundBalanceNegative" ? accounts.find((a) => a.id === account) : undefined;
  return (
    <>
      <TransactionList
        key={written}
        spaceId={spaceId}
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
      {/* The origin is the list without `tx`: closing never re-shows a dismissed notice. */}
      {detail ? (
        <TransactionSheetHost
          spaceId={spaceId}
          detail={detail}
          context={context}
          origin={transactionListHref(spaceId, filter)}
          api={api}
        />
      ) : null}
    </>
  );
}
