import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, CategoryGroupDto, PeriodDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { getMe, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { TransactionList } from "./transaction-list";

export const PAGE_SIZE = 50;

/**
 * The period's first page, the categories and accounts that name its rows (archived ones too: old rows keep their
 * names), and the neighbouring periods, from the day before the start and the day after the end (ruling P130).
 */
export const loadTransactionList = async (
  api: Api,
  input: { spaceId: string; period?: string; categoryId?: string },
): Promise<
  Loaded<{
    page: TransactionPageDto;
    groups: CategoryGroupDto[];
    accounts: AccountDto[];
    previous: PeriodDto | null;
    next: PeriodDto | null;
  }>
> => {
  const path = { spaceId: input.spaceId };
  const [page, categories, accounts] = await Promise.all([
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/transactions", {
        params: { path, query: { period: input.period, categoryIds: input.categoryId, limit: PAGE_SIZE } },
      }),
    ),
    loaded(api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path, query: { archived: "true" } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path, query: { archived: "true" } } })),
  ]);
  if (!page.ok) return page;
  if (!categories.ok) return categories;
  if (!accounts.ok) return accounts;
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
    data: { page: page.data, groups: categories.data.items, accounts: accounts.data.items, previous, next },
  };
};

/** Server: the transaction list of a space for `?period=` and `?category=`, in the person's formats and zone. */
export async function TransactionListContainer({
  spaceId,
  period,
  categoryId,
}: {
  readonly spaceId: string;
  readonly period?: string;
  readonly categoryId?: string;
}) {
  const [me, list] = await Promise.all([
    getMe(),
    loadTransactionList(await serverApi(), { spaceId, period, categoryId }),
  ]);
  if (!list.ok) return <ProblemNotice problem={list.problem} />;
  const { page, groups, accounts, previous, next } = list.data;
  const context = {
    formats: me!.preferences.effective,
    viewerZone: me!.timezone,
    groups,
    accountNames: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
  };
  return (
    <TransactionList
      spaceId={spaceId}
      page={page}
      context={context}
      today={nowIn(serverNow(), me!.timezone).date}
      filter={{ period, categoryId }}
      previous={previous}
      next={next}
    />
  );
}
