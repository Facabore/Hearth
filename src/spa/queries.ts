import { queryOptions } from "@tanstack/react-query";
import type { Api } from "@/shared/ui/api/client";
import type {
  AccountDto,
  CategoryGroupDto,
  LineDashboardDto,
  MeDto,
  MemberDto,
  PeriodDto,
  SignUpMode,
  SpaceDto,
} from "@/shared/ui/api/dto";
import { meFrom, outcomeOf, signUpModeFrom } from "@/shared/ui/api/readers";
import { read } from "./read";

/**
 * ADR 0006: every read is a query keyed by module and parameters. The first key is the module; sign-out and a change of
 * person drop every key but `identity` and `i18n` (guards.ts).
 */
export const queryKeys = {
  me: ["identity", "me"] as const,
  signUpMode: ["identity", "sign-up-mode"] as const,
  spaces: ["spaces", "list"] as const,
};

/** The signed-in person, or null when the API answers 401; any other failure throws (ruling P145). */
export const meQuery = (api: Api) =>
  queryOptions<MeDto | null>({
    queryKey: queryKeys.me,
    queryFn: async () => meFrom(await api.GET("/api/v1/me")),
  });

/** Ruling P143: closed only when the API says so; a failed read answers open. */
export const signUpModeQuery = (api: Api) =>
  queryOptions<SignUpMode>({
    queryKey: queryKeys.signUpMode,
    queryFn: async () => {
      try {
        return signUpModeFrom(await api.GET("/api/v1/auth/sign-up"));
      } catch {
        return "open";
      }
    },
  });

/** The person's spaces; the shell cannot render without them, so a problem throws to the error screen. */
export const spacesQuery = (api: Api) =>
  queryOptions<SpaceDto[]>({
    queryKey: queryKeys.spaces,
    queryFn: async () => {
      const outcome = outcomeOf(await api.GET("/api/v1/spaces"));
      if (outcome.kind !== "ok") throw new Error(`Listing the spaces failed: ${outcome.kind}`);
      return outcome.data.items;
    },
  });

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
  categories: (spaceId: string, archived: Archived) => ["categories", spaceId, archived] as const,
  members: (spaceId: string) => ["members", spaceId] as const,
  period: (spaceId: string, from: string) => ["periods", spaceId, from] as const,
  reports: (spaceId: string) => ["reports", spaceId] as const,
  lineReport: (spaceId: string, period: string) => ["reports", spaceId, "lines", period] as const,
};

const archivedQuery = (archived: Archived) => (archived === "all" ? { archived: "true" as const } : {});

export const accountsQuery = (api: Api, spaceId: string, archived: Archived) =>
  queryOptions<AccountDto[]>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.accountList(spaceId, archived),
    queryFn: async () =>
      (
        await read(
          api.GET("/api/v1/spaces/{spaceId}/accounts", {
            params: { path: { spaceId }, query: archivedQuery(archived) },
          }),
        )
      ).items,
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
export const periodQuery = (api: Api, spaceId: string, from: string) =>
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
