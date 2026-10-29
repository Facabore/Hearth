import { queryOptions } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
// Types only: the loaders sit in the app shell, the ledger's components in each screen's own chunk.
import type { ListFilter } from "@/modules/ledger/ui";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { Api } from "@/shared/ui/api/client";
import type { TransactionDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { outcomeOf } from "@/shared/ui/api/readers";
import { nowIn } from "@/shared/ui/time/when";
import {
  accountsQuery,
  categoriesQuery,
  LOADER_OWNED,
  lineReportQuery,
  membersQuery,
  periodQuery,
  unifiedViewQuery,
} from "../reads";
import { ensurer, sharedSpace, viewerOf, type Load, type Viewer } from "../load";
import { read } from "../read";

/** The home's latest rows and the list's page size, as the Next.js containers read them. */
export const HOME_ROWS = 3;
export const PAGE_SIZE = 50;

/** One page of a space's transactions: the API's own query, so it is the key too. */
export interface PageQuery {
  readonly period?: string | undefined;
  readonly categoryIds?: string | undefined;
  readonly payerMemberId?: string | undefined;
  readonly limit: number;
}

/**
 * ADR 0006: the ledger's reads, keyed by module, space and parameters, so a write can invalidate exactly the space's
 * pages and the one transaction it changed.
 */
export const ledgerKeys = {
  pages: (spaceId: string) => ["ledger", spaceId, "transactions"] as const,
  page: (spaceId: string, query: PageQuery) => ["ledger", spaceId, "transactions", query] as const,
  transaction: (spaceId: string, id: string) => ["ledger", spaceId, "transaction", id] as const,
  /** How many movements of the space the app has written: no read, a counter the writes bump (`writes.ts`). */
  writes: (spaceId: string) => ["ledger", spaceId, "writes"] as const,
};

/**
 * The counter's value; no read, ever. "Cargar más" keeps its rows in its own state, out of the cache, so Movimientos
 * starts the list afresh after a write rather than leave a row there that the write changed or removed.
 */
export const writesQuery = (spaceId: string) =>
  queryOptions<number>({
    queryKey: ledgerKeys.writes(spaceId),
    queryFn: () => 0,
    enabled: false,
    initialData: 0,
    staleTime: Infinity,
  });

export const pageQuery = (api: Api, spaceId: string, query: PageQuery) =>
  queryOptions<TransactionPageDto>({
    ...LOADER_OWNED,
    queryKey: ledgerKeys.page(spaceId, query),
    queryFn: () =>
      read(api.GET("/api/v1/spaces/{spaceId}/transactions", { params: { path: { spaceId }, query } })),
  });

export const listQueryOf = (filter: ListFilter): PageQuery => ({
  period: filter.period,
  categoryIds: filter.categoryId,
  payerMemberId: filter.payerMemberId,
  limit: PAGE_SIZE,
});

/** The transaction behind `?tx=` or an edit, or what the API said instead: the sheet shows a missing one (P189). */
export interface TransactionRead {
  readonly tx: TransactionDto | null;
  readonly problem: Problem | null;
  readonly missing: boolean;
}

export const transactionQuery = (api: Api, spaceId: string, transactionId: string) =>
  queryOptions<TransactionRead>({
    ...LOADER_OWNED,
    queryKey: ledgerKeys.transaction(spaceId, transactionId),
    queryFn: async () => {
      try {
        const result = await api.GET("/api/v1/spaces/{spaceId}/transactions/{transactionId}", {
          params: { path: { spaceId, transactionId } },
        });
        const outcome = outcomeOf(result);
        return outcome.kind === "ok"
          ? { tx: outcome.data, problem: null, missing: false }
          : {
              tx: null,
              problem: problemFrom(result.error, result.response),
              missing: outcome.kind === "missing",
            };
      } catch (error) {
        return { tx: null, problem: problemFrom(error, undefined), missing: false };
      }
    },
  });

/** Names only: a read that fails leaves its labels out, never the screen (as the Next.js containers do). */
const settled = (read: Promise<unknown>): Promise<void> =>
  read.then(
    () => undefined,
    () => undefined,
  );

/**
 * The detail's reads (ruling P189): the transaction, and in a shared space its members and the viewer's own accounts.
 * Opening a row is arriving at it, so its detail is refreshed even when the list under it stays.
 */
const loadDetail = async (load: Load, viewer: Viewer, transactionId: string): Promise<void> => {
  const ensure = ensurer({ ...load, cause: "enter" });
  const { api } = load.apis;
  const shared = sharedSpace(viewer.space);
  await Promise.all([
    ensure(transactionQuery(api, viewer.space.id, transactionId)),
    shared ? settled(ensure(membersQuery(api, viewer.space.id))) : undefined,
    shared ? settled(ensure(accountsQuery(api, personalSpaceOf(viewer.spaces).id, "all"))) : undefined,
  ]);
};

/**
 * HU-E9-01's home: its latest rows, the active accounts, every category (old rows keep their names) and the detail
 * behind `?tx=`.
 */
export const loadHome = async (load: Load, spaceId: string, transactionId?: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const page = ensure(pageQuery(api, spaceId, { limit: HOME_ROWS }));
  // U4 (#209): a personal home with other spaces refreshes the month across all of them beside it, never holding it.
  void Promise.all([page, viewerOf(load, spaceId)])
    .then(([{ period }, viewer]) =>
      viewer?.space.kind === "PERSONAL" && viewer.spaces.some(sharedSpace)
        ? ensure(unifiedViewQuery(api, spaceId, period.label))
        : undefined,
    )
    .catch(() => undefined);
  await Promise.all([
    page,
    ensure(accountsQuery(api, spaceId, "active")),
    ensure(categoriesQuery(api, spaceId, "all")),
    transactionId
      ? viewerOf(load, spaceId).then((viewer) => viewer && loadDetail(load, viewer, transactionId))
      : undefined,
  ]);
};

/** HU-E9-03's list: the page, every category and account, a shared space's members and the neighbouring periods. */
export const loadList = async (load: Load, spaceId: string, filter: ListFilter, transactionId?: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = viewerOf(load, spaceId);
  await Promise.all([
    ensure(pageQuery(api, spaceId, listQueryOf(filter))).then(({ period }) =>
      Promise.all(
        [addDays(period.startDate as LocalDate, -1), addDays(period.endDate as LocalDate, 1)].map((from) =>
          settled(ensure(periodQuery(api, spaceId, from))),
        ),
      ),
    ),
    ensure(categoriesQuery(api, spaceId, "all")),
    ensure(accountsQuery(api, spaceId, "all")),
    viewer.then((v) => (v && sharedSpace(v.space) ? ensure(membersQuery(api, spaceId)) : undefined)),
    transactionId ? viewer.then((v) => v && loadDetail(load, v, transactionId)) : undefined,
  ]);
};

/** HU-E9-06 (P168): a shared or direct space's members and the recorder's own accounts. */
const loadShared = (load: Load, viewer: Viewer, spaceAccounts: "active" | "all") => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  return Promise.all([
    ensure(membersQuery(api, viewer.space.id)),
    ensure(accountsQuery(api, personalSpaceOf(viewer.spaces).id, "active")),
    ensure(accountsQuery(api, viewer.space.id, spaceAccounts)),
  ]);
};

/** #142 (P236): today's period and its line dashboard; neither ever fails the form. */
const loadLineWatch = async (load: Load, viewer: Viewer) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const today = nowIn(new Date(), viewer.me.timezone).date;
  const period = await ensure(periodQuery(api, viewer.space.id, today)).catch(() => null);
  if (period) await settled(ensure(lineReportQuery(api, viewer.space.id, period.label)));
};

/** HU-E9-03's record form: the active accounts and categories, who shares or whom to split with, and the line watch. */
export const loadRecord = async (load: Load, spaceId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = viewerOf(load, spaceId);
  await Promise.all([
    ensure(accountsQuery(api, spaceId, "active")),
    ensure(categoriesQuery(api, spaceId, "active")),
    viewer.then((v) => {
      if (!v) return undefined;
      // P172: a personal expense can be split with the people of every other space; one that fails is left out.
      const people = sharedSpace(v.space)
        ? loadShared(load, v, "active")
        : Promise.all(
            v.spaces.filter(sharedSpace).map((space) => settled(ensure(membersQuery(api, space.id)))),
          );
      return Promise.all([people, loadLineWatch(load, v)]);
    }),
  ]);
};

/**
 * Ruling P191: the edit form's transaction, every account and category, and a shared space's members. A transaction
 * that is gone is not found (N1).
 */
export const loadEdit = async (load: Load, spaceId: string, transactionId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const viewer = viewerOf(load, spaceId);
  const [read] = await Promise.all([
    ensure(transactionQuery(api, spaceId, transactionId)),
    ensure(accountsQuery(api, spaceId, "all")),
    ensure(categoriesQuery(api, spaceId, "all")),
    viewer.then((v) => (v && sharedSpace(v.space) ? loadShared(load, v, "all") : undefined)),
  ]);
  if (read.missing) throw notFound();
};
