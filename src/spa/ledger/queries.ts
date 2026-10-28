import {
  queryOptions,
  useQueries,
  useQuery,
  useSuspenseQueries,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import {
  actionsFor,
  lineWatchOf,
  peopleOf,
  sharedContextOf,
  type ListFilter,
  type SharedExpenseContext,
  type TransactionDetail,
} from "@/modules/ledger/ui";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { Api } from "@/shared/ui/api/client";
import type {
  CategoryGroupDto,
  MeDto,
  MemberDto,
  SpaceDto,
  TransactionDto,
  TransactionPageDto,
} from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { outcomeOf } from "@/shared/ui/api/readers";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import type { RouterContext } from "../guards";
import {
  accountsQuery,
  categoriesQuery,
  LOADER_OWNED,
  lineReportQuery,
  meQuery,
  membersQuery,
  periodQuery,
  spacesQuery,
} from "../queries";
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
};

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

interface Viewer {
  readonly me: MeDto;
  readonly spaces: readonly SpaceDto[];
  readonly space: SpaceDto;
}

/** The person and the space of the URL; the shell's loader already answered a space they are not in. */
const viewerOf = async ({ queryClient, apis }: RouterContext, spaceId: string): Promise<Viewer | null> => {
  const [me, spaces] = await Promise.all([
    queryClient.ensureQueryData(meQuery(apis.sessionApi)),
    queryClient.ensureQueryData(spacesQuery(apis.api)),
  ]);
  const space = spaces.find((s) => s.id === spaceId);
  return me && space ? { me, spaces, space } : null;
};

const sharedSpace = (space: SpaceDto) => space.kind !== "PERSONAL";

/** Queries a screen reads only sometimes, as a plain list: hooks are called the same way on every render. */
const when = <T>(yes: boolean, queries: T[]): T[] => (yes ? queries : []);

/**
 * ADR 0006's stale-while-revalidate: a read already in the cache resolves at once and is refreshed in the background,
 * on a visit and on a prefetch on intent alike (a tap reuses the prefetch's load), so the screen paints from the cache
 * and then shows what changed elsewhere; a read not in the cache is waited for.
 */
const ensurer =
  ({ queryClient }: RouterContext): QueryClient["ensureQueryData"] =>
  (options) =>
    queryClient.ensureQueryData({ ...options, revalidateIfStale: true });

/** The detail's reads (ruling P189): the transaction, and in a shared space its members and the viewer's own accounts. */
const loadDetail = async (load: RouterContext, viewer: Viewer, transactionId: string): Promise<void> => {
  const ensure = ensurer(load);
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
export const loadHome = async (load: RouterContext, spaceId: string, transactionId?: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  await Promise.all([
    ensure(pageQuery(api, spaceId, { limit: HOME_ROWS })),
    ensure(accountsQuery(api, spaceId, "active")),
    ensure(categoriesQuery(api, spaceId, "all")),
    transactionId
      ? viewerOf(load, spaceId).then((viewer) => viewer && loadDetail(load, viewer, transactionId))
      : undefined,
  ]);
};

/** HU-E9-03's list: the page, every category and account, a shared space's members and the neighbouring periods. */
export const loadList = async (
  load: RouterContext,
  spaceId: string,
  filter: ListFilter,
  transactionId?: string,
) => {
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
const loadShared = (load: RouterContext, viewer: Viewer, spaceAccounts: "active" | "all") => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  return Promise.all([
    ensure(membersQuery(api, viewer.space.id)),
    ensure(accountsQuery(api, personalSpaceOf(viewer.spaces).id, "active")),
    ensure(accountsQuery(api, viewer.space.id, spaceAccounts)),
  ]);
};

/** #142 (P236): today's period and its line dashboard; neither ever fails the form. */
const loadLineWatch = async (load: RouterContext, viewer: Viewer) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const today = nowIn(new Date(), viewer.me.timezone).date;
  const period = await ensure(periodQuery(api, viewer.space.id, today)).catch(() => null);
  if (period) await settled(ensure(lineReportQuery(api, viewer.space.id, period.label)));
};

/** HU-E9-03's record form: the active accounts and categories, who shares or whom to split with, and the line watch. */
export const loadRecord = async (load: RouterContext, spaceId: string) => {
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
export const loadEdit = async (load: RouterContext, spaceId: string, transactionId: string) => {
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

/** The person and the URL's space, from the cache the guards and the shell filled. */
export const useViewer = (spaceId: string): Viewer => {
  const { api, sessionApi } = useApis();
  const me = useSuspenseQuery(meQuery(sessionApi)).data;
  const spaces = useSuspenseQuery(spacesQuery(api)).data;
  const space = spaces.find((s) => s.id === spaceId);
  if (!me || !space) throw notFound();
  return { me, spaces, space };
};

/** What a row needs to name itself (`RowContext`): the person's formats and zone, categories, accounts, members. */
export const rowContextOf = (
  me: MeDto,
  groups: readonly CategoryGroupDto[],
  accounts: readonly { readonly id: string; readonly name: string }[],
  memberNames: Record<string, string> = {},
) => ({
  formats: me.preferences.effective,
  viewerZone: me.timezone,
  groups: [...groups],
  accountNames: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
  memberNames,
});

/** Ruling P189: the detail sheet's data behind `?tx=`, or nothing while no row is open. */
export const useTransactionDetail = (
  viewer: Viewer,
  transactionId?: string,
): TransactionDetail | undefined => {
  const { api } = useApis();
  const { me, spaces, space } = viewer;
  const open = transactionId !== undefined;
  const shared = sharedSpace(space);
  const read = useQuery({ ...transactionQuery(api, space.id, transactionId ?? ""), enabled: open });
  const members = useQuery({ ...membersQuery(api, space.id), enabled: open && shared });
  const own = useQuery({
    ...accountsQuery(api, personalSpaceOf(spaces).id, "all"),
    enabled: open && shared,
  });
  if (!open || !read.data) return undefined;
  const items = shared ? (members.data ?? []) : [];
  return {
    tx: read.data.tx,
    problem: read.data.problem,
    members: items,
    viewer: {
      userId: me.id,
      role: space.role,
      memberId: items.find((m) => m.userId === me.id)?.id ?? null,
    },
    ownAccountNames: shared ? Object.fromEntries((own.data ?? []).map((a) => [a.id, a.name])) : {},
  };
};

export const useHome = (viewer: Viewer) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const [page, accounts, groups] = useSuspenseQueries({
    queries: [
      pageQuery(api, spaceId, { limit: HOME_ROWS }),
      accountsQuery(api, spaceId, "active"),
      categoriesQuery(api, spaceId, "all"),
    ],
  });
  return {
    page: page.data,
    accounts: accounts.data,
    context: rowContextOf(viewer.me, groups.data, accounts.data),
  };
};

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
  const members = useSuspenseQueries({ queries: when(shared, [membersQuery(api, spaceId)]) });
  const { period } = page.data;
  const previous = useQuery(periodQuery(api, spaceId, addDays(period.startDate as LocalDate, -1)));
  const next = useQuery(periodQuery(api, spaceId, addDays(period.endDate as LocalDate, 1)));
  const memberNames = Object.fromEntries((members[0]?.data ?? []).map((m) => [m.id, m.displayName]));
  return {
    page: page.data,
    accounts: accounts.data,
    context: rowContextOf(viewer.me, groups.data, accounts.data, memberNames),
    previous: previous.data ?? null,
    next: next.data ?? null,
  };
};

/** HU-E9-06 (P168): who pays and shares in a shared or direct space; the person must still be a member. */
const useShared = (
  viewer: Viewer,
  spaceAccounts: "active" | "all",
): { shared: SharedExpenseContext | undefined } => {
  const { api } = useApis();
  const shared = sharedSpace(viewer.space);
  const [members] = useSuspenseQueries({ queries: when(shared, [membersQuery(api, viewer.space.id)]) });
  const [personal, own] = useSuspenseQueries({
    queries: when(shared, [
      accountsQuery(api, personalSpaceOf(viewer.spaces).id, "active"),
      accountsQuery(api, viewer.space.id, spaceAccounts),
    ]),
  });
  if (!members || !personal || !own) return { shared: undefined };
  const context = sharedContextOf({
    meUserId: viewer.me.id,
    members: members.data,
    spaceAccounts: own.data,
    personalAccounts: personal.data,
  });
  if (!context) throw notFound();
  return { shared: context };
};

export const useRecord = (viewer: Viewer) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const [accounts, groups] = useSuspenseQueries({
    queries: [accountsQuery(api, spaceId, "active"), categoriesQuery(api, spaceId, "active")],
  });
  const { shared } = useShared(viewer, "active");
  const others = sharedSpace(viewer.space) ? [] : viewer.spaces.filter(sharedSpace);
  const memberReads = useQueries({ queries: others.map((space) => membersQuery(api, space.id)) });
  const today = nowIn(new Date(), viewer.me.timezone).date;
  const period = useQuery(periodQuery(api, spaceId, today));
  const label = period.data?.label;
  const report = useQuery({ ...lineReportQuery(api, spaceId, label ?? ""), enabled: label !== undefined });
  const membersBySpace: Record<string, readonly MemberDto[]> = {};
  others.forEach((space, i) => {
    const members = memberReads[i]?.data;
    if (members) membersBySpace[space.id] = members;
  });
  return {
    accounts: accounts.data,
    groups: groups.data,
    shared,
    people: shared ? undefined : peopleOf({ meUserId: viewer.me.id, spaces: others, membersBySpace }),
    lineWatch: report.data ? lineWatchOf(report.data) : null,
  };
};

const accountsOf = (tx: TransactionDto): ReadonlySet<string> =>
  new Set(
    [tx.sourceAccountId, tx.destinationAccountId, ...tx.payments.map((payment) => payment.accountId)].filter(
      (id): id is string => id !== null,
    ),
  );

/** Ruling P191: the edit form's data; a transaction that is gone is not found, one the viewer may not edit is not editable. */
export const useEdit = (viewer: Viewer, transactionId: string) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const [read, accounts, groups] = useSuspenseQueries({
    queries: [
      transactionQuery(api, spaceId, transactionId),
      accountsQuery(api, spaceId, "all"),
      categoriesQuery(api, spaceId, "all"),
    ],
  });
  const { shared } = useShared(viewer, "all");
  const { tx, problem, missing } = read.data;
  // Gone since the loader read it (deleted elsewhere): the not-found screen, as the loader answers (N1).
  if (missing) return { missing: true, problem: null, tx: null } as const;
  if (!tx) return { missing: false, problem: problem!, tx: null } as const;
  const used = accountsOf(tx);
  return {
    missing: false,
    problem: null,
    tx,
    accounts: accounts.data.filter((a) => a.archivedAt === null || used.has(a.id)),
    groups: groups.data,
    shared,
    actions: actionsFor(
      tx,
      { userId: viewer.me.id, role: viewer.space.role, memberId: shared?.meMemberId ?? null },
      shared?.members ?? [],
    ),
  } as const;
};
