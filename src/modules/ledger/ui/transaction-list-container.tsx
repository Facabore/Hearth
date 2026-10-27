import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  CategoryGroupDto,
  PeriodDto,
  SpaceDto,
  TransactionPageDto,
} from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { loadTransactionDetail } from "./detail/detail-loader";
import { TransactionList } from "./transaction-list";

export const PAGE_SIZE = 50;

/**
 * The period's first page, the categories and accounts that name its rows (archived ones too: old rows keep their
 * names), and the neighbouring periods, from the day before the start and the day after the end (ruling P130). Issue
 * #196: every read starts at once; the members wait only for `shared`, the neighbours only for the page's period.
 */
export const loadTransactionList = async (
  api: Api,
  input: {
    spaceId: string;
    period?: string;
    categoryId?: string;
    payerMemberId?: string;
    /** Whether the space is shared or direct; it may still be arriving with the person's spaces. */
    shared?: boolean | PromiseLike<boolean>;
  },
): Promise<
  Loaded<{
    page: TransactionPageDto;
    groups: CategoryGroupDto[];
    accounts: AccountDto[];
    /** Member id to display name of a shared space (ruling P171); empty in a personal space. */
    memberNames: Record<string, string>;
    previous: PeriodDto | null;
    next: PeriodDto | null;
  }>
> => {
  const path = { spaceId: input.spaceId };
  const page = loaded(
    api.GET("/api/v1/spaces/{spaceId}/transactions", {
      params: {
        path,
        query: {
          period: input.period,
          categoryIds: input.categoryId,
          payerMemberId: input.payerMemberId,
          limit: PAGE_SIZE,
        },
      },
    }),
  );
  const neighbour = async (from: string) => {
    const result = await loaded(
      api.GET("/api/v1/spaces/{spaceId}/periods", { params: { path, query: { from, count: 1 } } }),
    );
    return result.ok ? (result.data.items[0] ?? null) : null;
  };
  const neighbours = page.then((first) =>
    first.ok
      ? Promise.all([
          neighbour(addDays(first.data.period.startDate as LocalDate, -1)),
          neighbour(addDays(first.data.period.endDate as LocalDate, 1)),
        ])
      : null,
  );
  // A failed read below returns first and leaves the neighbours unawaited: never an unhandled rejection.
  void neighbours.catch(() => undefined);
  const [first, categories, accounts, members] = await Promise.all([
    page,
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path, query: { archived: "true" } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path, query: { archived: "true" } } })),
    Promise.resolve(input.shared).then((shared) =>
      shared ? loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })) : null,
    ),
  ]);
  if (!first.ok) return first;
  if (!categories.ok) return categories;
  if (!accounts.ok) return accounts;
  if (members && !members.ok) return members;
  const [previous, next] = (await neighbours) ?? [null, null];
  return {
    ok: true,
    data: {
      page: first.data,
      groups: categories.data.items,
      accounts: accounts.data.items,
      memberNames: members ? Object.fromEntries(members.data.items.map((m) => [m.id, m.displayName])) : {},
      previous,
      next,
    },
  };
};

/** Server: the transaction list of a space for `?period=` and `?category=`, in the person's formats and zone. */
export async function TransactionListContainer({
  spaceId,
  period,
  categoryId,
  payerMemberId,
  notice,
  noticeAccount,
  transactionId,
}: {
  readonly spaceId: string;
  readonly period?: string;
  readonly categoryId?: string;
  /** Issue #148: `?payer=<member id>`, what one member paid. */
  readonly payerMemberId?: string;
  /** `?notice=FundBalanceNegative&account=<fund id>` after a save that left a shared fund negative (P170). */
  readonly notice?: string;
  readonly noticeAccount?: string;
  /** `?tx=<id>`: the transaction whose detail sheet is open (ruling P189). */
  readonly transactionId?: string;
}) {
  // Issue #196: the list's reads start with the person and their spaces; only what needs the space waits for it.
  const reads = Promise.all([getMe(), getSpaces()]);
  const spaceOf = (spaces: readonly SpaceDto[]) => spaces.find((s) => s.id === spaceId);
  const shared = reads.then(([, spaces]) => (spaceOf(spaces)?.kind ?? "PERSONAL") !== "PERSONAL");
  const list = serverApi().then((api) =>
    loadTransactionList(api, { spaceId, period, categoryId, payerMemberId, shared }),
  );
  const details = Promise.all([serverApi(), reads]).then(([api, [me, spaces]]) => {
    const space = spaceOf(spaces);
    return transactionId && space
      ? loadTransactionDetail(api, {
          spaceId,
          transactionId,
          space,
          meUserId: me!.id,
          personalSpaceId: spaces.find((s) => s.kind === "PERSONAL")?.id,
        })
      : undefined;
  });
  // A failed read of the person or their spaces throws first and leaves these unawaited.
  void shared.catch(() => undefined);
  void list.catch(() => undefined);
  void details.catch(() => undefined);
  const [me, spaces] = await reads;
  const space = spaceOf(spaces);
  const [loadedList, detail] = await Promise.all([list, details]);
  if (!loadedList.ok) return <ProblemNotice problem={loadedList.problem} />;
  const { page, groups, accounts, memberNames, previous, next } = loadedList.data;
  const isShared = (space?.kind ?? "PERSONAL") !== "PERSONAL";
  const context = {
    formats: me!.preferences.effective,
    viewerZone: me!.timezone,
    groups,
    accountNames: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    memberNames,
  };
  // The balance is the fund's balance now, read with the list: no amount ever travels in the address (P170).
  const fund = notice === "FundBalanceNegative" ? accounts.find((a) => a.id === noticeAccount) : undefined;
  return (
    <TransactionList
      spaceId={spaceId}
      page={page}
      context={context}
      today={nowIn(serverNow(), me!.timezone).date}
      filter={{ period, categoryId, payerMemberId }}
      {...(detail ? { detail } : {})}
      {...(fund ? { notice: { accountName: fund.name, balance: fund.balance } } : {})}
      {...(isShared && space ? { spaceName: space.name } : {})}
      periodPolicy={space?.periodPolicy}
      previous={previous}
      next={next}
    />
  );
}
