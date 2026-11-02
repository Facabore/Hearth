import type { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { Locale } from "@/i18n/locale";
import type { MeDto } from "@/shared/ui/api/dto";
import { createSpa } from "@/spa/app";
import { queryKeys } from "@/spa/queries";
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

/** The person's language is now `locale`, as the profile answers once it is saved (HU-E9-02). */
export const speak = ({ queryClient }: { readonly queryClient: QueryClient }, locale: Locale): void =>
  void queryClient.setQueryData<MeDto | null>(queryKeys.me, (me) => (me ? { ...me, locale } : me));

/** The area catalogs the app has loaded, as `<locale>:<area>` (ruling P276). */
export const loadedAreas = ({ queryClient }: { readonly queryClient: QueryClient }): string[] =>
  queryClient
    .getQueryCache()
    .findAll({ queryKey: ["i18n"] })
    .filter(({ queryKey, state }) => queryKey.length === 3 && state.status === "success")
    .map(({ queryKey }) => `${String(queryKey[1])}:${String(queryKey[2])}`)
    .sort();

/** From here on, every message a screen asked for and the texts did not hold, as use-intl reports it (`console.error`). */
export const watchMissingMessages = (): (() => string[]) => {
  const errors = vi.spyOn(console, "error");
  // A spy set again is the same spy: only what follows counts.
  errors.mockClear();
  return () =>
    errors.mock.calls
      .flat()
      .map((value) => (value instanceof Error ? value.message : String(value)))
      .filter((message) => message.startsWith("MISSING_MESSAGE"));
};
