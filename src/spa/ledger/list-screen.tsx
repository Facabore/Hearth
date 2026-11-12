import { useQuery } from "@tanstack/react-query";
import {
  TransactionSheetHost,
  transactionListHref,
  type ListFilter,
  type RowContext,
} from "@/modules/ledger/ui";
import type { AccountDto } from "@/shared/ui/api/dto";
import { useApis } from "../api";
import type { Viewer } from "../load";
import { usePendingNames } from "../recurring-pending/queries";
import { useTransactionDetail } from "./hooks";
import { writesQuery } from "./queries";

/** What both Movimientos lists read from the address beside their filter. */
export interface ListSearch {
  readonly tx?: string | undefined;
  readonly notice?: string | undefined;
  readonly account?: string | undefined;
}

/** A Movimientos list's screen: the person and space, the filter it shows, and its address. */
export interface ListScreenProps {
  readonly viewer: Viewer;
  readonly filter: ListFilter;
  readonly search: ListSearch;
}

/** What both lists show around their rows: the writes that restart them, the pending banner, a saved notice's fund. */
export const useListState = (viewer: Viewer, search: ListSearch, accounts: readonly AccountDto[]) => {
  // A write starts the list afresh, rows "Cargar más" added included: none of them can show what the write changed.
  const written = useQuery(writesQuery(viewer.space.id)).data;
  // HU-E9-09 (ruling P270): the banner to "Por confirmar", from the read the shell's badge already holds.
  const pendingNames = usePendingNames(viewer.space);
  // The balance is the fund's balance now, read with the list: no amount ever travels in the address (P170).
  const fund =
    search.notice === "FundBalanceNegative" ? accounts.find((a) => a.id === search.account) : undefined;
  return { written, pendingNames, fund };
};

/** Ruling P189: the space's own row behind `?tx=`, in a sheet over the list. */
export function ListDetail({
  viewer,
  filter,
  context,
  tx,
}: {
  readonly viewer: Viewer;
  readonly filter: ListFilter;
  readonly context: RowContext;
  readonly tx: string | undefined;
}) {
  const { api } = useApis();
  const detail = useTransactionDetail(viewer, tx);
  // The origin is the list without `tx`: closing never re-shows a dismissed notice.
  return detail ? (
    <TransactionSheetHost
      spaceId={viewer.space.id}
      detail={detail}
      context={context}
      origin={transactionListHref(viewer.space.id, filter)}
      api={api}
    />
  ) : null;
}
