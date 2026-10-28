import type { QueryClient } from "@tanstack/react-query";
import type { AccountDto } from "@/shared/ui/api/dto";
import { moduleKeys } from "../reads";
import type { WritePlanner } from "../write-plan";

const ACCOUNTS = "/api/v1/spaces/{spaceId}/accounts";
const ONE = `${ACCOUNTS}/{accountId}`;
const WRITES = new Set([
  `POST ${ACCOUNTS}`,
  `POST ${ACCOUNTS}/starter`,
  `PATCH ${ONE}`,
  `POST ${ONE}/archive`,
  `POST ${ONE}/restore`,
]);

/**
 * An account changes its space's account lists, balances and totals (computed on read, D7) and the plan's reports,
 * which read its opening balance and its funds. A personal account also pays in shared spaces, whose screens read it
 * from the personal space's lists, under the same key. Rows name accounts from those lists, so the ledger reads nothing.
 */
const changed = (queryClient: QueryClient, spaceId: string, data: unknown, accountId: string | undefined) => {
  if (accountId) queryClient.setQueryData(moduleKeys.account(spaceId, accountId), data as AccountDto);
  void queryClient.invalidateQueries({ queryKey: moduleKeys.accounts(spaceId) });
  void queryClient.invalidateQueries({ queryKey: moduleKeys.reports(spaceId) });
};

/** The accounts' writes in the SPA: create, the starter accounts (issue 169), edit, archive and restore. */
export const accountWrites: WritePlanner = (call) => {
  if (!WRITES.has(`${call.method} ${call.path}`)) return null;
  const { spaceId = "", accountId } = call.params;
  return { accepted: (queryClient, data) => changed(queryClient, spaceId, data, accountId) };
};
