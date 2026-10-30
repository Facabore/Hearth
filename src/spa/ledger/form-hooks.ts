import { useQueries, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import {
  actionsFor,
  lineWatchOf,
  peopleOf,
  sharedContextOf,
  type SharedExpenseContext,
} from "@/modules/ledger/ui";
import { personalSpaceOf } from "@/modules/spaces/ui";
import type { MemberDto, TransactionDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { accountsQuery, categoriesQuery, lineReportQuery, membersQuery, periodQuery } from "../reads";
import { sharedSpace, type Viewer } from "../load";
import { transactionQuery } from "./queries";

/**
 * The record and edit forms' query hooks (P127 in the SPA, ADR 0006): each reads what its loader put in the cache and
 * hands the form its props. A module apart from the home's and the lists' hooks (`hooks.ts`), so the forms' routes
 * load only what the forms read.
 */

/** Queries a screen reads only sometimes, as a plain list: hooks are called the same way on every render. */
const when = <T>(yes: boolean, queries: T[]): T[] => (yes ? queries : []);

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
