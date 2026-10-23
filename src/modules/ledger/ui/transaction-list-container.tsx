import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, CategoryGroupDto, PeriodDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { loadTransactionDetail } from "./detail/detail-loader";
import { TransactionList } from "./transaction-list";

export const PAGE_SIZE = 50;

/**
 * The period's first page, the categories and accounts that name its rows (archived ones too: old rows keep their
 * names), and the neighbouring periods, from the day before the start and the day after the end (ruling P130).
 */
export const loadTransactionList = async (
  api: Api,
  input: { spaceId: string; period?: string; categoryId?: string; shared?: boolean },
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
  const [page, categories, accounts, members] = await Promise.all([
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/transactions", {
        params: { path, query: { period: input.period, categoryIds: input.categoryId, limit: PAGE_SIZE } },
      }),
    ),
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path, query: { archived: "true" } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path, query: { archived: "true" } } })),
    input.shared ? loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })) : null,
  ]);
  if (!page.ok) return page;
  if (!categories.ok) return categories;
  if (!accounts.ok) return accounts;
  if (members && !members.ok) return members;
  const neighbour = async (from: string) => {
    const result = await loaded(
      api.GET("/api/v1/spaces/{spaceId}/periods", { params: { path, query: { from, count: 1 } } }),
    );
    return result.ok ? (result.data.items[0] ?? null) : null;
  };
  const { startDate, endDate } = page.data.period;
  const [previous, next] = await Promise.all([
    neighbour(addDays(startDate as LocalDate, -1)),
    neighbour(addDays(endDate as LocalDate, 1)),
  ]);
  return {
    ok: true,
    data: {
      page: page.data,
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
  notice,
  noticeAccount,
  transactionId,
}: {
  readonly spaceId: string;
  readonly period?: string;
  readonly categoryId?: string;
  /** `?notice=FundBalanceNegative&account=<fund id>` after a save that left a shared fund negative (P170). */
  readonly notice?: string;
  readonly noticeAccount?: string;
  /** `?tx=<id>`: the transaction whose detail sheet is open (ruling P189). */
  readonly transactionId?: string;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId);
  const shared = (space?.kind ?? "PERSONAL") !== "PERSONAL";
  const api = await serverApi();
  const [list, detail] = await Promise.all([
    loadTransactionList(api, { spaceId, period, categoryId, shared }),
    transactionId && space
      ? loadTransactionDetail(api, {
          spaceId,
          transactionId,
          space,
          meUserId: me!.id,
          personalSpaceId: spaces.find((s) => s.kind === "PERSONAL")?.id,
        })
      : undefined,
  ]);
  if (!list.ok) return <ProblemNotice problem={list.problem} />;
  const { page, groups, accounts, memberNames, previous, next } = list.data;
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
      filter={{ period, categoryId }}
      {...(detail ? { detail } : {})}
      {...(fund ? { notice: { accountName: fund.name, balance: fund.balance } } : {})}
      {...(shared && space ? { spaceName: space.name } : {})}
      previous={previous}
      next={next}
    />
  );
}
