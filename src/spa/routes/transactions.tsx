import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { TransactionList, TransactionSheetHost, transactionListHref } from "@/modules/ledger/ui";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { useList, useTransactionDetail, useViewer } from "../ledger/hooks";
import { writesQuery } from "../ledger/queries";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/transactions");

/**
 * HU-E9-03: Movimientos from the query cache (ADR 0006), `?period=`, `?category=` and `?payer=` (#148); `?tx=<id>`
 * opens a row's detail sheet over it (P189), and `?notice=FundBalanceNegative&account=` follows a save that left a
 * shared fund negative (P170).
 */
export function TransactionsScreen() {
  useTitle(useTranslations("ledger.list")("title"));
  const { spaceId } = route.useParams();
  const { period, category, payer, notice, account, tx } = route.useSearch();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const filter = { period, categoryId: category, payerMemberId: payer };
  const { page, accounts, context, previous, next } = useList(viewer, filter);
  const detail = useTransactionDetail(viewer, tx);
  const { me, space } = viewer;
  // A write starts the list afresh, rows "Cargar más" added included: none of them can show what the write changed.
  const written = useQuery(writesQuery(spaceId)).data;
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
