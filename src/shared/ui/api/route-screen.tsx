// Server Components only: a route's page and layout (#196).
import { useTranslations } from "next-intl";
import { cache, type ReactNode } from "react";
import { isDocumentRequest, requestSearchParams } from "./server";

/** A page's query as Next hands it over: a repeated name is a list. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** A route's page, built by `routeScreen`; `prerender` is what its layout calls on a document request. */
export type ScreenPage<P> = ((props: {
  readonly params: Promise<P>;
  readonly searchParams: Promise<SearchParams>;
}) => ReactNode | Promise<ReactNode>) & {
  readonly prerender: (params: P, search: SearchParams) => Promise<void>;
};

/**
 * Issue #196: a route's page whose screen renders once per request. `render` calls the route's containers as functions,
 * and a container that picks another one calls it too, so every read and every `notFound()` and `redirect()` of the
 * screen runs inside it, not later when React renders an element. Once `prerender` has run, the page returns that
 * screen itself rather than a promise: its loading boundary never suspends, so the document streams no skeleton first.
 */
export const routeScreen = <P extends Record<string, string>, S extends SearchParams = SearchParams>(
  render: (params: P, search: S) => Promise<ReactNode>,
): ScreenPage<P> => {
  const once = cache((key: string): Promise<ReactNode> => {
    const { params, search } = JSON.parse(key) as { params: P; search: S };
    return render(params, search);
  });
  const keyOf = (params: P, search: SearchParams) => JSON.stringify({ params, search });
  const prerendered = cache((): { done: boolean; screen?: ReactNode } => ({ done: false }));
  const page = ({
    params,
    searchParams,
  }: {
    readonly params: Promise<P>;
    readonly searchParams: Promise<SearchParams>;
  }) => {
    const prerender = prerendered();
    if (prerender.done) return prerender.screen;
    return (async () => once(keyOf(await params, await searchParams)))();
  };
  return Object.assign(page, {
    prerender: async (params: P, search: SearchParams) => {
      const screen = await once(keyOf(params, search));
      Object.assign(prerendered(), { done: true, screen });
    },
  });
};

/**
 * next-intl's server hooks `use()` one promise per request, and its first use suspends. Made here, around the loading
 * boundary, it holds back the start of the stream, and the boundary renders only once the promise has settled: the
 * screen's own uses under it no longer suspend, which would stream the skeleton ahead of a finished screen.
 */
function IntlReady({ children }: { readonly children: ReactNode }) {
  useTranslations();
  return children;
}

/**
 * Issue #196: the layout of a route with a loading boundary. A layout renders outside its own segment's boundary, so on a
 * document request it renders the screen first and the stream starts only once the screen is ready: a not-found keeps
 * its 404 and a redirect stays a server redirect (ruling N1). The page then hands back that render. A client navigation
 * or a prefetch skips it, and the prefetched skeleton shows the moment the route is tapped.
 */
export const documentFirst = <P extends Record<string, string>>(page: ScreenPage<P>) =>
  async function DocumentFirstLayout({
    children,
    params,
  }: {
    readonly children: ReactNode;
    readonly params: Promise<P>;
  }) {
    if (!(await isDocumentRequest())) return children;
    await page.prerender(await params, await requestSearchParams());
    return <IntlReady>{children}</IntlReady>;
  };
