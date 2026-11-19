import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { notFound, useMatches } from "@tanstack/react-router";
import { resolveLocale } from "@/i18n/locale";
import type { FriendDto, FriendsApproximateDto } from "@/modules/balances/ui";
import {
  activeSpaceOf,
  type AppShellProps,
  type MyBalanceDto,
  type SpaceStandingView,
} from "@/modules/spaces/ui";
import type { Api } from "@/shared/ui/api/client";
import { useApis } from "./api";
import type { RouterContext } from "./guards";
import { read } from "./read";
import { meQuery, spacesQuery } from "./queries";

export type Shell = Pick<AppShellProps, "me" | "spaces" | "activeSpace">;

/**
 * Ruling P278: the switcher's cards with the person's standing ride in Inicio's chunk, which holds the amount formats;
 * `space-home.tsx` fills this slot when that chunk loads.
 */
export const spaceStandingSlot: { current?: SpaceStandingView } = {};

/**
 * Ruling P278: the person's standing in each shared and direct space, read by Inicio and by the switcher when it opens.
 * An optional read: it never retries, and a screen without it draws as before.
 */
export const myBalancesQuery = (api: Api) =>
  queryOptions<readonly MyBalanceDto[]>({
    queryKey: ["balances", "mine"],
    queryFn: async () => (await read(api.GET("/api/v1/me/balances"))).items,
    retry: false,
  });

/** Ruling P338: the person's Amigos, beside her standing in each space. */
export const friendsKey = ["balances", "mine", "friends"] as const;

/**
 * Ruling P338: each person the viewer shares a direct space with, her net there and their newest movement (computed on
 * read, D7). Amigos' loaders read it again on each visit (ADR 0006), so mounting a screen does not; Inicio's line reads
 * it on its own. Here, beside `myBalancesQuery`, so Inicio's chunk holds no copy of the screens' reads.
 */
export const myFriendsQuery = (api: Api) =>
  queryOptions<readonly FriendDto[]>({
    refetchOnMount: false,
    queryKey: friendsKey,
    queryFn: async ({ client }) => {
      const { items, approximate } = await read(api.GET("/api/v1/me/friends"));
      // Ruling P342 (S6): the "≈" totals ride on the same answer; kept beside the rows, whose shape the writes rely on.
      client.setQueryData(friendsApproximateKey, approximate ?? null);
      return items;
    },
  });

/** Ruling P342 (S6): under Amigos' key, so whatever reads Amigos again reads them again too. */
const friendsApproximateKey = [...friendsKey, "approximate"] as const;

/**
 * Ruling P342 (S6): Amigos' totals added up in one currency at today's rate, null when every debt is in one currency.
 * `myFriendsQuery`'s read fills it, so it costs no request of its own; only when that answer is gone does it read
 * Amigos again, once.
 */
export const myFriendsApproximateQuery = (api: Api) =>
  queryOptions<FriendsApproximateDto | null>({
    queryKey: friendsApproximateKey,
    staleTime: Infinity,
    refetchOnMount: false,
    queryFn: async ({ client }) => {
      await client.fetchQuery(myFriendsQuery(api));
      const kept = client.getQueryData<FriendsApproximateDto | null>(friendsApproximateKey);
      if (kept !== undefined) return kept;
      await client.fetchQuery({ ...myFriendsQuery(api), staleTime: 0 });
      return client.getQueryData<FriendsApproximateDto | null>(friendsApproximateKey) ?? null;
    },
  });

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /**
     * Ruling P272: a stacked screen, whose board draws only its own back header (`ScreenHeader`): the shell around it
     * shows no space switcher, profile or bottom navigation. The tab destinations leave it out.
     */
    readonly stacked?: boolean;
  }
}

/** Whether the screen on show is a stacked one (ruling P272), read from its route's `staticData`, never its path. */
export const useStacked = (): boolean =>
  useMatches({ select: (matches) => matches.some((match) => match.staticData.stacked === true) });

/**
 * The app shell's data (P127 in the SPA: a query hook plus the existing `AppShell`). The URL's space, or for a screen
 * without one the space `?from=` names when it is one of the person's own (N3), else the personal one; null for a
 * space the person is not in.
 */
export const useShell = (spaceId: string | null, from?: string): Shell | null => {
  const { api, sessionApi } = useApis();
  const me = useSuspenseQuery(meQuery(sessionApi)).data;
  const spaces = useSuspenseQuery(spacesQuery(api)).data;
  const activeSpace = me ? activeSpaceOf(spaces, spaceId, from) : null;
  return me && activeSpace
    ? {
        me: {
          id: me.id,
          name: me.name,
          email: me.email,
          locale: resolveLocale({ userLocale: me.locale }),
          handle: me.handle,
          formats: me.preferences.effective,
        },
        spaces,
        activeSpace,
      }
    : null;
};

/** The shell route's loader: the cache paints at once and refreshes behind; a space the person is not in is not found. */
export const loadShell = async (
  { queryClient, apis }: RouterContext,
  spaceId: string | null,
  from?: string,
): Promise<void> => {
  const [me, spaces] = await Promise.all([
    queryClient.ensureQueryData(meQuery(apis.sessionApi)),
    queryClient.ensureQueryData(spacesQuery(apis.api)),
  ]);
  if (me && activeSpaceOf(spaces, spaceId, from) === null) throw notFound();
};
