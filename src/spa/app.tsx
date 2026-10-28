import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, type RouterHistory } from "@tanstack/react-router";
import { ApisProvider, spaApis, type SpaApis } from "./api";
import { registerBrowserApi } from "./next/api-client";
import { IntlRoot } from "./i18n";
import { isTransient } from "./read";
import { createSpaRouter } from "./router";
import { appWrites, trackWrites } from "./writes-catalog";

/**
 * ADR 0006: TanStack Query owns server state. A read that failed for a passing reason is tried once more before its
 * screen says so; one the API refused or did not find would answer the same again, so its screen says so at once.
 */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => failures < 1 && isTransient(error),
      },
    },
  });

/**
 * The whole app: its query cache, its two API clients, the router and the texts. `apisFor` builds the clients from the
 * router's own location, so a session that ends mid-use returns to this app's sign-in screen (ruling P151).
 */
export const createSpa = ({
  queryClient = createQueryClient(),
  apisFor = spaApis,
  history,
}: {
  readonly queryClient?: QueryClient;
  readonly apisFor?: typeof spaApis;
  readonly history?: RouterHistory;
} = {}) => {
  const clients = apisFor({
    get origin() {
      return globalThis.location.origin;
    },
    get pathname() {
      return router.state.location.pathname;
    },
    get search() {
      return router.state.location.searchStr;
    },
    assign: (url) => void router.navigate({ href: url }),
  });
  // The screens' writes run as mutations over the query cache; the guards' profile read is no write's business.
  const apis: SpaApis = { ...clients, api: trackWrites(clients.api, queryClient, appWrites) };
  registerBrowserApi(apis.api);
  // The location above is read only once the app runs, after the router exists.
  const router = createSpaRouter({ queryClient, apis }, history);
  function Spa() {
    return (
      <QueryClientProvider client={queryClient}>
        <ApisProvider apis={apis}>
          <IntlRoot>
            <RouterProvider router={router} />
          </IntlRoot>
        </ApisProvider>
      </QueryClientProvider>
    );
  }
  return { Spa, router, queryClient, apis };
};
