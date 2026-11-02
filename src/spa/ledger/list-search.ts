// Types only: the loaders sit in the app shell, the ledger's components in each screen's own chunk.
import type { ListFilter, TransactionKind } from "@/modules/ledger/ui";
import { textParam } from "../search";

const KINDS: readonly string[] = ["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"] satisfies TransactionKind[];

/**
 * HU-E9-03 and ruling P277: Movimientos' filter as its address writes it: `?period=`, `?category=`, `?payer=` (#148),
 * `?acct=`, `?type=` and `?q=`. A type the API does not know is no filter, and neither is a blank search.
 */
export const listFilterOf = (search: Readonly<Record<string, unknown>>): ListFilter => {
  const type = textParam(search.type);
  return {
    period: textParam(search.period),
    categoryId: textParam(search.category),
    payerMemberId: textParam(search.payer),
    accountId: textParam(search.acct),
    type: type !== undefined && KINDS.includes(type) ? (type as TransactionKind) : undefined,
    search: textParam(search.q)?.trim() || undefined,
  };
};
