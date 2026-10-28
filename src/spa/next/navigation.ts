import { useQueryClient } from "@tanstack/react-query";
import {
  notFound as routeNotFound,
  redirect as routeRedirect,
  useRouter as useRouteRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useMemo } from "react";
import { bumpLocale } from "../locale-epoch";
import { takeSettledWrite } from "../write-plan";

/** The part of Next.js's App Router the components call, over TanStack Router and the query cache (ADR 0006). */
export interface AppRouterInstance {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  back(): void;
  forward(): void;
  /**
   * Next.js renders the page again on the server; here the screen's queries are read again and the guards run again.
   * After a save that went through the app's writes, the cache already holds what changed, so nothing is read again.
   */
  refresh(): void;
  prefetch(href: string): void;
}

export function useRouter(): AppRouterInstance {
  const router = useRouteRouter();
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      push: (href) => void router.navigate({ href }),
      replace: (href) => void router.navigate({ href, replace: true }),
      back: () => router.history.back(),
      forward: () => router.history.forward(),
      refresh: () => {
        // The language cookie has no change event; reading it again needs no network.
        bumpLocale();
        if (takeSettledWrite(queryClient)) return;
        void queryClient.invalidateQueries();
        void router.invalidate();
      },
      prefetch: (href) => void router.preloadRoute({ href } as never).catch(() => undefined),
    }),
    [router, queryClient],
  );
}

export const usePathname = (): string => useRouterState({ select: (state) => state.location.pathname });

/** Next.js hands a read-only URLSearchParams; the query string is the router's, as written. */
export const useSearchParams = (): URLSearchParams => {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  return useMemo(() => new URLSearchParams(search), [search]);
};

export const notFound = (): never => {
  throw routeNotFound();
};

export const redirect = (href: string): never => {
  throw routeRedirect({ href });
};
