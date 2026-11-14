import { queryOptions } from "@tanstack/react-query";
import { personalSpaceOf } from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, PersonalSpendingByGroupDto, SpendingByGroupDto } from "@/shared/ui/api/dto";
import { myPageQuery, neighboursOf, PAGE_SIZE, pageQuery, transactionQuery } from "../ledger/queries";
import { ensurer, sharedSpace, viewerOf, type Load, type Viewer } from "../load";
import { read } from "../read";
import {
  accountQuery,
  accountsQuery,
  categoriesQuery,
  LOADER_OWNED,
  membersQuery,
  moduleKeys,
} from "../reads";

/**
 * Ruling P327 (#315): an account's own screen. A personal account lists what it did in every space of the person
 * (P319, `/me`); a shared fund the space's movements with it (P277). Its breakdown is the spending-by-group read of
 * that same scope with its `accountId`.
 */

/** The movements' query: the API's own, so it is the key too (ADR 0006). */
export const movementsQueryOf = (period: string | undefined, accountId: string) => ({
  period,
  accountId,
  limit: PAGE_SIZE,
});

/** Ruling P327: what the account paid by group and what it moved, keyed under its space's reports. */
export type AccountReport = SpendingByGroupDto | PersonalSpendingByGroupDto;

export const accountReportQuery = (
  api: Api,
  space: Pick<Viewer["space"], "id" | "kind">,
  accountId: string,
  period: string,
) =>
  queryOptions<AccountReport>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(space.id, "account-groups", { period, accountId }),
    queryFn: () =>
      space.kind === "PERSONAL"
        ? read(api.GET("/api/v1/me/reports/spending-by-group", { params: { query: { period, accountId } } }))
        : read(
            api.GET("/api/v1/spaces/{spaceId}/reports/spending-by-group", {
              params: { path: { spaceId: space.id }, query: { period, accountId } },
            }),
          ),
  });

/** Names only: a read that fails leaves its labels or figures out, never the screen. */
const settled = (promise: Promise<unknown>): Promise<void> =>
  promise.then(
    () => undefined,
    () => undefined,
  );

/**
 * Ruling P327: the account (an unknown one is not found), its period's movements, and what names their rows: the space's
 * categories and accounts, and in a shared space its members and the viewer's own accounts (a contribution's source).
 * The breakdown, the neighbouring periods and the row behind `?tx=` never fail the screen.
 */
export const loadAccountScreen = async (
  load: Load,
  spaceId: string,
  accountId: string,
  period?: string,
  transactionId?: string,
) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = await viewerOf(load, spaceId);
  if (viewer === null) return;
  // A personal account's page across every space of the person, or the fund's in its space: the loader needs its period.
  const query = movementsQueryOf(period, accountId);
  const page: Promise<{ readonly period: PeriodDto }> =
    viewer.space.kind === "PERSONAL"
      ? ensure(myPageQuery(api, spaceId, query))
      : ensure(pageQuery(api, spaceId, query));
  const shared = sharedSpace(viewer.space);
  await Promise.all([
    ensure(accountQuery(api, spaceId, accountId)),
    page.then(({ period: shown }) =>
      Promise.all([
        settled(ensure(accountReportQuery(api, viewer.space, accountId, shown.label))),
        ...neighboursOf(api, spaceId, shown).map((query) => settled(ensure(query))),
      ]),
    ),
    ensure(categoriesQuery(api, spaceId, "all")),
    ensure(accountsQuery(api, spaceId, "all")),
    shared ? ensure(membersQuery(api, spaceId)) : undefined,
    shared ? settled(ensure(accountsQuery(api, personalSpaceOf(viewer.spaces).id, "all"))) : undefined,
    transactionId ? settled(ensure(transactionQuery(api, spaceId, transactionId))) : undefined,
  ]);
};
