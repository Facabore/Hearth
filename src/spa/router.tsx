import { createRouter, type RouterHistory } from "@tanstack/react-router";
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
