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
  if (route.options.loader && route.options.shouldReload === undefined)
    route.update({ shouldReload: ({ cause }: { readonly cause: string }) => cause === "enter" } as never);
  for (const child of (route.children as readonly AnyRoute[] | undefined) ?? []) reloadOnEnter(child);
};
reloadOnEnter(routeTree);

export const createSpaRouter = (context: RouterContext, history?: RouterHistory) =>
  createRouter({
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

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createSpaRouter>;
  }
}
