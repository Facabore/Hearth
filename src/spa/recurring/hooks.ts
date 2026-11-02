import { useSuspenseQueries } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { sharedContextOf } from "@/modules/ledger/ui";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { sharedSpace, type Viewer } from "../load";
import { accountsQuery, categoriesQuery, membersQuery, type Archived } from "../reads";
import { recurrenceQuery, recurrencesQuery, upcomingQuery } from "./queries";

/**
 * HU-E9-09's query hooks (P127 in the SPA, ADR 0006): each reads what its loader put in the cache and hands the screen
 * its props.
 */

/** Queries a screen reads only sometimes, as a plain list: hooks are called the same way on every render. */
const when = <T>(yes: boolean, queries: T[]): T[] => (yes ? queries : []);

/** The space's accounts, categories and members, and in a shared space the person's own personal accounts (P168). */
const useNames = (viewer: Viewer, archived: Archived) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const shared = sharedSpace(viewer.space);
  const [accounts, groups, members] = useSuspenseQueries({
    queries: [
      accountsQuery(api, spaceId, archived),
      categoriesQuery(api, spaceId, archived),
      membersQuery(api, spaceId),
    ],
  });
  const [personal] = useSuspenseQueries({
    queries: when(shared, [accountsQuery(api, personalSpaceOf(viewer.spaces).id, archived)]),
  });
  const ownAccounts = personal?.data ?? [];
  return {
    accounts: accounts.data,
    groups: groups.data,
    members: members.data,
    personal: ownAccounts,
    accountNames: Object.fromEntries([...accounts.data, ...ownAccounts].map((a) => [a.id, a.name])),
    memberNames: Object.fromEntries(members.data.map((m) => [m.id, m.displayName])),
  };
};

export const useRecurrences = (viewer: Viewer) => {
  const { api } = useApis();
  const [recurrences] = useSuspenseQueries({ queries: [recurrencesQuery(api, viewer.space.id)] });
  const { groups, accountNames, memberNames } = useNames(viewer, "all");
  return { recurrences: recurrences.data, groups, accountNames, memberNames };
};

export const useRecurrence = (viewer: Viewer, recurrenceId: string) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const [recurrence, upcoming] = useSuspenseQueries({
    queries: [recurrenceQuery(api, spaceId, recurrenceId), upcomingQuery(api, spaceId, recurrenceId)],
  });
  const { groups, accountNames, memberNames } = useNames(viewer, "all");
  return {
    recurrence: recurrence.data,
    upcoming: upcoming.data,
    groups,
    accountNames,
    memberNames,
    today: nowIn(new Date(), viewer.me.timezone).date,
  };
};

/** The form's props: what it offers, the person's member id, and a shared space's payers and split (HU-E9-06). */
export const useRecurrenceForm = (viewer: Viewer) => {
  const { accounts, groups, members, personal } = useNames(viewer, "active");
  const me = members.find((member) => member.userId === viewer.me.id);
  // A space the person no longer belongs to: the not-found screen, as the record form answers.
  if (!me) throw notFound();
  const shared = sharedSpace(viewer.space)
    ? (sharedContextOf({
        meUserId: viewer.me.id,
        members,
        spaceAccounts: accounts,
        personalAccounts: personal,
      }) ?? undefined)
    : undefined;
  return {
    accounts,
    groups,
    meMemberId: me.id,
    shared,
    today: nowIn(new Date(), viewer.me.timezone).date,
  };
};

/** The edit form's recurrence, and every category: it may use one archived since. */
export const useRecurrenceEdit = (viewer: Viewer, recurrenceId: string) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const [recurrence, groups] = useSuspenseQueries({
    queries: [recurrenceQuery(api, spaceId, recurrenceId), categoriesQuery(api, spaceId, "all")],
  });
  return { ...useRecurrenceForm(viewer), recurrence: recurrence.data, groups: groups.data };
};
