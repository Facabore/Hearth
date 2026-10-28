import { useQueries, useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
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
import type { CategoryGroupDto, MeDto, MemberDto, TransactionDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import {
  accountsQuery,
  categoriesQuery,
  lineReportQuery,
  meQuery,
  membersQuery,
  periodQuery,
  spacesQuery,
} from "../queries";
import { HOME_ROWS, listQueryOf, pageQuery, sharedSpace, transactionQuery, type Viewer } from "./queries";

/**
 * The ledger's screens as query hooks (P127 in the SPA, ADR 0006): each reads what its loader put in the cache and
 * hands the existing components their props. They load with each screen's own chunk, never with the app shell.
 */

/** Queries a screen reads only sometimes, as a plain list: hooks are called the same way on every render. */
const when = <T>(yes: boolean, queries: T[]): T[] => (yes ? queries : []);

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
