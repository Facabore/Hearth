import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { createSpa } from "@/spa/app";
import { fakeApi, type FakeHandler } from "./fake-api";

/**
 * The SPA at `url` over a fake /api/v1: its real router, guards,
 * query cache and texts. `location()` is the app's own path and query; `browserHref()` what the address bar shows.
 */
export const renderSpa = (url: string, routes: Record<string, FakeHandler>) => {
  const { api, requests } = fakeApi(routes);
  const history = createMemoryHistory({ initialEntries: [url] });
  const spa = createSpa({ history, apisFor: () => ({ api, sessionApi: api }) });
  const view = render(<spa.Spa />);
  return {
    ...view,
    ...spa,
    requests,
    location: () => spa.router.state.location.href,
    browserHref: () => `${history.location.pathname}${history.location.search}`,
  };
};
