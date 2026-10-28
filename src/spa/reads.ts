import { queryOptions } from "@tanstack/react-query";
import type { Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  AccountListDto,
  BalanceHistoryDto,
  BalancesDto,
  BudgetPlanDto,
  CapacitySuggestionDto,
  CashFlowDto,
  CategoryGroupDto,
  FundTrackingDto,
  InvitationDto,
  LineDashboardDto,
  LineTrendDto,
  MemberDto,
  MemberMatrixDto,
  PeriodDto,
  PersonalSpendingByGroupDto,
  PersonalTrendDto,
  SpendingByGroupDto,
  SuggestionDto,
  UnifiedViewDto,
} from "@/shared/ui/api/dto";
import { isTransient, read } from "./read";

// The screens' reads (ADR 0006), keyed by module first. They load with the screens and their loaders, never with the
// app shell, whose own reads are in queries.ts.

/**
 * Reads whose screens' loaders revalidate them on every visit and on every prefetch (ADR 0006): mounting a screen never
 * fetches them again, so a visit costs one background read per query, and a write invalidates them by key.
 */
export const LOADER_OWNED = { refetchOnMount: false } as const;

/** Active accounts only, or archived ones too: an old row keeps naming its own (ruling P130). */
export type Archived = "active" | "all";

/** The reads of the other modules that the ledger's screens name rows and fill forms with, keyed by module first. */
export const moduleKeys = {
  accounts: (spaceId: string) => ["accounts", spaceId] as const,
  accountList: (spaceId: string, archived: Archived) => ["accounts", spaceId, archived] as const,
  account: (spaceId: string, accountId: string) => ["accounts", spaceId, "account", accountId] as const,
  categoryLists: (spaceId: string) => ["categories", spaceId] as const,
  categories: (spaceId: string, archived: Archived) => ["categories", spaceId, archived] as const,
  members: (spaceId: string) => ["members", spaceId] as const,
  invitations: (spaceId: string) => ["members", spaceId, "invitations"] as const,
  balances: (spaceId: string) => ["balances", spaceId] as const,
  netBalances: (spaceId: string) => ["balances", spaceId, "net"] as const,
  suggestions: (spaceId: string) => ["balances", spaceId, "suggestions"] as const,
  balanceHistory: (spaceId: string, memberId: string, from: string, to: string) =>
    ["balances", spaceId, "history", memberId, { from, to }] as const,
  preview: (kind: "invitation" | "claim", token: string) => ["invitations", kind, token] as const,
  plans: (spaceId: string) => ["plans", spaceId] as const,
  plan: (spaceId: string, planId: string) => ["plans", spaceId, planId] as const,
  report: (spaceId: string, kind: string, query: Record<string, string | number>) =>
    ["reports", spaceId, kind, query] as const,
  /** `from` undefined: the space's current period. */
  period: (spaceId: string, from: string | undefined) => ["periods", spaceId, from ?? "current"] as const,
  reports: (spaceId: string) => ["reports", spaceId] as const,
  lineReport: (spaceId: string, period: string) => ["reports", spaceId, "lines", period] as const,
};

const archivedQuery = (archived: Archived) => (archived === "all" ? { archived: "true" as const } : {});

/**
 * A space's accounts with their totals, as the API answers them (computed on read, D7): the accounts screen reads the
 * whole answer; every other screen selects its items from the same cached read.
 */
export const accountListQuery = (api: Api, spaceId: string, archived: Archived) =>
  queryOptions<AccountListDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.accountList(spaceId, archived),
    queryFn: () =>
      read(
        api.GET("/api/v1/spaces/{spaceId}/accounts", {
          params: { path: { spaceId }, query: archivedQuery(archived) },
        }),
      ),
  });

export const accountsQuery = (api: Api, spaceId: string, archived: Archived) =>
  queryOptions({ ...accountListQuery(api, spaceId, archived), select: (list: AccountListDto) => list.items });

/** One account with its stored and default style (#120, P253), for its edit form; a 404 is not found. */
export const accountQuery = (api: Api, spaceId: string, accountId: string) =>
  queryOptions<AccountDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.account(spaceId, accountId),
    queryFn: () =>
      read(
        api.GET("/api/v1/spaces/{spaceId}/accounts/{accountId}", {
          params: { path: { spaceId, accountId } },
        }),
      ),
  });

export const categoriesQuery = (api: Api, spaceId: string, archived: Archived) =>
  queryOptions<CategoryGroupDto[]>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.categories(spaceId, archived),
    queryFn: async () =>
      (
        await read(
          api.GET("/api/v1/spaces/{spaceId}/categories", {
            params: { path: { spaceId }, query: archivedQuery(archived) },
          }),
        )
      ).items,
  });

export const membersQuery = (api: Api, spaceId: string) =>
  queryOptions<MemberDto[]>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.members(spaceId),
    queryFn: async () =>
      (await read(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId } } }))).items,
  });

/** The space's period holding `from` (ruling P130's neighbours, P236's line watch); null past the last one. */
export const periodQuery = (api: Api, spaceId: string, from: string | undefined) =>
  queryOptions<PeriodDto | null>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.period(spaceId, from),
    queryFn: async () =>
      (
        await read(
          api.GET("/api/v1/spaces/{spaceId}/periods", {
            params: { path: { spaceId }, query: { from, count: 1 } },
          }),
        )
      ).items[0] ?? null,
  });

/** #142 (P236): the line dashboard of a period, which the record form warns from. */
export const lineReportQuery = (api: Api, spaceId: string, period: string) =>
  queryOptions<LineDashboardDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.lineReport(spaceId, period),
    queryFn: () =>
      read(
        api.GET("/api/v1/spaces/{spaceId}/reports/lines", {
          params: { path: { spaceId }, query: { period } },
        }),
      ),
  });

/** HU-E9-07: every current member's net balance in the space (computed on read, D7). */
export const netBalancesQuery = (api: Api, spaceId: string) =>
  queryOptions<BalancesDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.netBalances(spaceId),
    queryFn: () => read(api.GET("/api/v1/spaces/{spaceId}/balances", { params: { path: { spaceId } } })),
  });

/** HU-E9-07: the settle-up suggestions of the space. */
export const suggestionsQuery = (api: Api, spaceId: string) =>
  queryOptions<SuggestionDto[]>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.suggestions(spaceId),
    queryFn: async () =>
      (
        await read(
          api.GET("/api/v1/spaces/{spaceId}/balances/suggestions", { params: { path: { spaceId } } }),
        )
      ).suggestions,
  });

/** Ruling P155: the pending invitations of a space, which only someone who may invite can read. */
export const invitationsQuery = (api: Api, spaceId: string) =>
  queryOptions<InvitationDto[]>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.invitations(spaceId),
    queryFn: async () =>
      (await read(api.GET("/api/v1/spaces/{spaceId}/invitations", { params: { path: { spaceId } } }))).items,
  });

/** Ruling P176: a member's movements and running balance within a period of the space. */
export const balanceHistoryQuery = (api: Api, spaceId: string, memberId: string, period: PeriodDto) =>
  queryOptions<BalanceHistoryDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.balanceHistory(spaceId, memberId, period.startDate, period.endDate),
    queryFn: () =>
      read(
        api.GET("/api/v1/spaces/{spaceId}/members/{memberId}/balance-history", {
          params: { path: { spaceId, memberId }, query: { from: period.startDate, to: period.endDate } },
        }),
      ),
  });

/** A plan of the space, its lines and capacities (HU-E9-08); a 404 is not found. */
export const planQuery = (api: Api, spaceId: string, planId: string) =>
  queryOptions<BudgetPlanDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.plan(spaceId, planId),
    queryFn: () =>
      read(api.GET("/api/v1/spaces/{spaceId}/plans/{planId}", { params: { path: { spaceId, planId } } })),
  });

/**
 * Ruling P208: the caller's own capacity suggestion (the endpoint takes no member). One that cannot be read never
 * blocks the screen: it is null. A failure that may pass is thrown instead, so it is tried once more first.
 */
export const capacitySuggestionQuery = (api: Api, spaceId: string, planId: string) =>
  queryOptions<CapacitySuggestionDto | null>({
    ...LOADER_OWNED,
    queryKey: [...moduleKeys.plan(spaceId, planId), "suggestion"],
    queryFn: async () => {
      try {
        return await read(
          api.GET("/api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion", {
            params: { path: { spaceId, planId } },
          }),
        );
      } catch (error) {
        if (isTransient(error)) throw error;
        return null;
      }
    },
  });

/** A space's report for a period (HU-E9-10): the fund's contributions, the member matrix or spending by group. */
export const spaceReportQuery = <K extends "fund-contributions" | "member-matrix" | "spending-by-group">(
  api: Api,
  spaceId: string,
  kind: K,
  period: string,
) =>
  queryOptions<SpaceReport[K]>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(spaceId, kind, { period }),
    queryFn: () =>
      read(
        api.GET(
          `/api/v1/spaces/{spaceId}/reports/${kind}` as "/api/v1/spaces/{spaceId}/reports/member-matrix",
          {
            params: { path: { spaceId }, query: { period } },
          },
        ),
      ) as Promise<SpaceReport[K]>,
  });

interface SpaceReport {
  readonly "fund-contributions": FundTrackingDto;
  readonly "member-matrix": MemberMatrixDto;
  readonly "spending-by-group": SpendingByGroupDto;
}

/** HU-E9-11: every plan line's trend over the window ending in `period` (P219). */
export const lineTrendQuery = (api: Api, spaceId: string, period: string, periods: 6 | 12) =>
  queryOptions<LineTrendDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(spaceId, "trend", { period, periods }),
    queryFn: () =>
      read(
        api.GET("/api/v1/spaces/{spaceId}/reports/trend", {
          params: { path: { spaceId }, query: { endPeriod: period, periods } },
        }),
      ),
  });

/**
 * The caller's own reports, across every space of theirs (D11). They are keyed under the personal space, whose Plan tab
 * shows them, and a movement in any of the person's spaces invalidates them there.
 */
export const unifiedViewQuery = (api: Api, personalSpaceId: string, period: string) =>
  queryOptions<UnifiedViewDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(personalSpaceId, "unified", { period }),
    queryFn: () => read(api.GET("/api/v1/me/unified-view", { params: { query: { period } } })),
  });

export const personalGroupsQuery = (api: Api, personalSpaceId: string, period: string) =>
  queryOptions<PersonalSpendingByGroupDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(personalSpaceId, "my-groups", { period }),
    queryFn: () => read(api.GET("/api/v1/me/reports/spending-by-group", { params: { query: { period } } })),
  });

export const personalTrendQuery = (api: Api, personalSpaceId: string, period: string, periods: 6 | 12) =>
  queryOptions<PersonalTrendDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(personalSpaceId, "my-trend", { period, periods }),
    queryFn: () => read(api.GET("/api/v1/me/trend", { params: { query: { endPeriod: period, periods } } })),
  });

/** #150: the caller's cash flow over the next 30 or 60 days (ruling P241 of M6c). */
export const cashFlowQuery = (api: Api, personalSpaceId: string, days: 30 | 60) =>
  queryOptions<CashFlowDto>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(personalSpaceId, "cash-flow", { days }),
    queryFn: () =>
      read(api.GET("/api/v1/me/cash-flow", { params: { query: { days: String(days) as "30" | "60" } } })),
  });

/**
 * Ruling P216: a shared space's desktop overview; each part that cannot be read is left out, never the view. A
 * failure that may pass is thrown instead, so the overview is tried once more before any part is left out.
 */
export const overviewQuery = (api: Api, spaceId: string, period: string) =>
  queryOptions({
    ...LOADER_OWNED,
    queryKey: moduleKeys.report(spaceId, "overview", { period }),
    queryFn: async () => {
      const part = <T>(call: Promise<{ data?: T; error?: unknown; response: Response }>) =>
        read(call).catch((error: unknown) => {
          if (isTransient(error)) throw error;
          return null;
        });
      const path = { spaceId };
      const query = { period };
      const [matrix, fund, groups, trend, members] = await Promise.all([
        part(api.GET("/api/v1/spaces/{spaceId}/reports/member-matrix", { params: { path, query } })),
        part(api.GET("/api/v1/spaces/{spaceId}/reports/fund-contributions", { params: { path, query } })),
        part(api.GET("/api/v1/spaces/{spaceId}/reports/spending-by-group", { params: { path, query } })),
        part(
          api.GET("/api/v1/spaces/{spaceId}/reports/trend", {
            params: { path, query: { endPeriod: period, periods: 2 } },
          }),
        ),
        part(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })),
      ]);
      return { matrix, fund, groups, trend, members: members?.items ?? [] };
    },
  });
