import {
  createRouter,
  useRouter,
  type ErrorComponentProps,
  type RouterHistory,
} from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { ErrorScreen, NotFoundScreen } from "@/shared/ui";
import type { RouterContext } from "./guards";
import { routeTree } from "./routes";
import { parseSearch, stringifySearch } from "./search";
import { useTitle } from "./title";

/** The app's base: it lives at /app/ beside the Next.js UI until cut-over (ADR 0006, #199). */
export const BASE_PATH = "/app";

/** N1 inside the app: an address that leads nowhere gets the app's own screen (with a 200, ADR 0006). */
function AppNotFound() {
  useTitle(useTranslations("notFound")("title"));
  return <NotFoundScreen />;
}

/**
 * N2: a screen whose load failed, with Reintentar; an API that did not answer says so. Retrying loads the screen again
 * (its guards, loaders and queries), not only the boundary, which alone would show the same failure.
 */
function AppError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };
  return (
    <main className="mx-auto max-w-[420px] px-4 max-[359px]:px-3">
      <ErrorScreen onRetry={retry} variant={error instanceof TypeError ? "connection" : "unexpected"} />
    </main>
  );
}

export const createSpaRouter = (context: RouterContext, history?: RouterHistory) =>
  createRouter({
    routeTree,
    context,
    history,
    basepath: BASE_PATH,
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
