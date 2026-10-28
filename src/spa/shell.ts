import { useSuspenseQuery } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { resolveLocale } from "@/i18n/locale";
import { activeSpaceOf, type AppShellProps } from "@/modules/spaces/ui";
import { useApis } from "./api";
import type { RouterContext } from "./guards";
import { meQuery, spacesQuery } from "./queries";

export type Shell = Omit<AppShellProps, "children">;

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
        me: { name: me.name, email: me.email, locale: resolveLocale({ userLocale: me.locale }) },
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
