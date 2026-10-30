import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import type { ListFilter, TransactionDetail } from "@/modules/ledger/ui";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { CategoryGroupDto, MeDto } from "@/shared/ui/api/dto";
import { useApis } from "../api";
import { accountsQuery, categoriesQuery, membersQuery, netBalancesQuery, periodQuery } from "../reads";
import { sharedSpace, type Viewer } from "../load";
import { HOME_ROWS, listQueryOf, pageQuery, transactionQuery } from "./queries";

export { useViewer } from "../viewer";

/**
 * The ledger's screens as query hooks (P127 in the SPA, ADR 0006): each reads what its loader put in the cache and
 * hands the existing components their props. They load with each screen's own chunk, never with the app shell. The
 * record and edit forms' hooks are in `form-hooks.ts`, so the forms' routes never load the lists' code.
 */

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

/** #217 (P263): the members any movement touched, or nothing when the balances do not say (an older API, or none read). */
export const movedOf = (
  balances: readonly { readonly memberId: string; readonly hasMovements?: boolean | undefined }[] | undefined,
): string[] | undefined =>
  balances?.every((b) => b.hasMovements !== undefined)
    ? balances.filter((b) => b.hasMovements).map((b) => b.memberId)
    : undefined;

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
  // Hooks are called the same way on every render: the members are an empty list of queries outside a shared space.
  const memberQueries: ReturnType<typeof membersQuery>[] = shared ? [membersQuery(api, spaceId)] : [];
  const members = useSuspenseQueries({ queries: memberQueries });
  // #217 (P263): the payer filter leaves out members no movement touched. The balances are optional: until they are
  // read, or when they cannot be, every member is offered.
  const balances = useQuery({ ...netBalancesQuery(api, spaceId), enabled: shared });
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
    movedMemberIds: movedOf(balances.data?.members),
  };
};
