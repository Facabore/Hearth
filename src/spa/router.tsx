import { createRouter, type AnyRoute, type RouterHistory } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { NotFoundScreen } from "@/shared/ui";
import { AppError } from "./app-error";
import type { RouterContext } from "./guards";
import { routeTree } from "./routes";
import { parseSearch, stringifySearch } from "./search";
import { useTitle } from "./title";

/** N1 inside the app: an address that leads nowhere gets the app's own screen (with a 200, ADR 0006). */
function AppNotFound() {
  useTitle(useTranslations("notFound")("title"));
  return <NotFoundScreen />;
}

/**
 * ADR 0006: a screen's loader runs when the screen is entered, and a prefetch on intent runs it only for a screen the
 * cache has not loaded yet. Without this, every pass of the pointer over a link ran its screen's loader again and
 * re-read all of its queries, a burst of requests at each hover; the router has no default for it, so every route
 * with a loader gets it here. A tap still refreshes the screen: the navigation itself is an "enter".
 */
const reloadOnEnter = (route: AnyRoute): void => {
  type LoaderContext = { readonly preload: boolean; readonly cause: string };
  const loader = route.options.loader as ((context: LoaderContext) => unknown) | undefined;
  if (loader && route.options.shouldReload === undefined)
    route.update({
      shouldReload: ({ cause }: { readonly cause: string }) => cause === "enter",
      // Issue #302: which screens last loaded for a prefetch rather than a visit (see createSpaRouter).
      loader: (context: LoaderContext) => {
        // The first load after a prefetch that is not one is the visit the prefetch stood in for (createSpaRouter).
        const visit = !context.preload && lastLoadPrefetched.get(route.id) === true;
        lastLoadPrefetched.set(route.id, context.preload);
        return loader(visit ? { ...context, cause: "enter" } : context);
      },
    } as never);
  for (const child of (route.children as readonly AnyRoute[] | undefined) ?? []) reloadOnEnter(child);
};
const lastLoadPrefetched = new Map<string, boolean>();
reloadOnEnter(routeTree);

export const createSpaRouter = (context: RouterContext, history?: RouterHistory) => {
  const router = createRouter({
    routeTree,
    context,
    history,
    parseSearch,
    stringifySearch,
    // Preloading on intent goes through the query cache, so it is never wasted (ADR 0006).
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    notFoundMode: "root",
    defaultNotFoundComponent: AppNotFound,
    defaultErrorComponent: AppError,
  });
  // Issue #302: a tap that lands while its hover's prefetch is still in flight joins that prefetch instead of running
  // its loader as a visit, and a prefetch reads only what the cache lacks, so the screen kept what the cache held before
  // (a category created since, say). A screen shown whose last load was a prefetch is loaded once more, as the visit it
  // is, which revalidates its reads in the background (ADR 0006).
  router.subscribe("onResolved", () => {
    const prefetched = new Set(
      router.state.matches.filter((match) => lastLoadPrefetched.get(match.routeId)).map((match) => match.id),
    );
    if (prefetched.size > 0) void router.invalidate({ filter: (match) => prefetched.has(match.id) });
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createSpaRouter>;
  }
}
