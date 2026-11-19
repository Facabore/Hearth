import { queryOptions, useQueries, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { lineWatchOf, peopleOf } from "@/modules/ledger/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountUsageDto, MemberDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { accountsQuery, categoriesQuery, lineReportQuery, membersQuery, periodQuery } from "../reads";
import { sharedSpace, type Viewer } from "../load";
import { read } from "../read";
import { myFriendsQuery } from "../shell";
import { useShared } from "./form-hooks";
import { ledgerKeys } from "./queries";

/**
 * The record form's own query hooks (P127 in the SPA, ADR 0006), apart from the edit form's (`form-hooks.ts`): the
 * people, the plan's lines and the account usage only Registrar reads never load with the edit route (ADR 0004).
 */

/**
 * Ruling P337 (#334): how much the person used each account lately, which orders "Desde" and learns its default. Only
 * the record form reads it, never a loader, so the screens that share the ledger's queries do not carry it (ADR 0004):
 * the form opens without it and orders its accounts once it arrives.
 */
export const accountUsageQuery = (api: Api) =>
  queryOptions<AccountUsageDto>({
    queryKey: ledgerKeys.accountUsage(),
    queryFn: () => read(api.GET("/api/v1/me/account-usage")),
  });

export const useRecord = (viewer: Viewer) => {
  const { api } = useApis();
  const spaceId = viewer.space.id;
  const [accounts, groups] = useSuspenseQueries({
    queries: [accountsQuery(api, spaceId, "active"), categoriesQuery(api, spaceId, "active")],
  });
  const { shared } = useShared(viewer, "active");
  const others = sharedSpace(viewer.space) ? [] : viewer.spaces.filter(sharedSpace);
  // #338: the direct spaces' people come from Amigos' one read, so the form's reads never grow with the person's
  // friends; only the groups, which do not, read their members. The loader reads both (`loadRecord`); neither holds
  // the form up.
  const friends = useQuery({ ...myFriendsQuery(api), enabled: others.some((s) => s.kind === "DIRECT") });
  const sharedGroups = others.filter((space) => space.kind === "SHARED");
  const memberReads = useQueries({ queries: sharedGroups.map((space) => membersQuery(api, space.id)) });
  const today = nowIn(new Date(), viewer.me.timezone).date;
  const period = useQuery(periodQuery(api, spaceId, today));
  const label = period.data?.label;
  const report = useQuery({ ...lineReportQuery(api, spaceId, label ?? ""), enabled: label !== undefined });
  // Ruling P337: never holds the form up; without it Desde lists by name and starts on the last account used.
  const usage = useQuery(accountUsageQuery(api));
  const membersBySpace: Record<string, readonly MemberDto[]> = {};
  sharedGroups.forEach((space, i) => {
    const members = memberReads[i]?.data;
    if (members) membersBySpace[space.id] = members;
  });
  return {
    accounts: accounts.data,
    groups: groups.data,
    shared,
    people: shared
      ? undefined
      : peopleOf({ meUserId: viewer.me.id, spaces: others, friends: friends.data ?? [], membersBySpace }),
    lineWatch: report.data ? lineWatchOf(report.data) : null,
    accountUsage: usage.data ?? null,
  };
};
