import { useSuspenseQueries } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { sharedContextOf, type SharedExpenseContext } from "@/modules/ledger/ui";
import { personalSpaceOf } from "@/modules/spaces/ui";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { useApis } from "../api";
import { accountsQuery, categoriesQuery, membersQuery } from "../reads";
import { sharedSpace, type Viewer } from "../load";
import { transactionQuery } from "./queries";

/**
 * The edit form's query hooks and the shared space's payers, which the record and recurrence forms read too (P127 in
 * the SPA, ADR 0006): each reads what its loader put in the cache and hands the form its props. A module apart from
 * the home's and the lists' hooks (`hooks.ts`), and from the record form's own (`record-hooks.ts`), so each form's
 * route loads only what its form reads (ADR 0004).
 */

/** Queries a screen reads only sometimes, as a plain list: hooks are called the same way on every render. */
const when = <T>(yes: boolean, queries: T[]): T[] => (yes ? queries : []);

/**
 * HU-E9-06 (P168): who pays and shares in a shared or direct space; the person must still be a member. The recurrence
 * form (#77) reads it too, so both forms offer the same payers and split.
 */
export const useShared = (
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
  // Ruling P309 (S6): the split sheet offers to add guests when the viewer's role in this space allows it.
  return { shared: { ...context, space: viewer.space } };
};

const accountsOf = (tx: TransactionDto): ReadonlySet<string> =>
  new Set(
    [tx.sourceAccountId, tx.destinationAccountId, ...tx.payments.map((payment) => payment.accountId)].filter(
      (id): id is string => id !== null,
    ),
  );

/**
 * Ruling P191: the edit form's data; a transaction that is gone is not found. Whether the viewer may edit it is the
 * route's to ask (`actionsFor`), so the record route, which shares this module, never loads that rule.
 */
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
  } as const;
};
