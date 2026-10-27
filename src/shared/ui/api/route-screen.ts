// Server Components only: a route's page and layout (#196).
import { cache, type ReactNode } from "react";
import { isDocumentRequest, requestSearchParams } from "./server";

/** A page's query as Next hands it over: a repeated name is a list. */
export type SearchParams = Record<string, string | string[] | undefined>;

/** A route's page, built by `routeScreen`. */
export type ScreenPage<P> = (props: {
  readonly params: Promise<P>;
  readonly searchParams: Promise<SearchParams>;
}) => Promise<ReactNode>;

/**
 * Issue #196: a route's page whose screen renders once per request. `render` calls the route's containers as functions,
 * so their reads and their `notFound()` and `redirect()` run inside it, not later when React renders an element.
 */
export const routeScreen = <P extends Record<string, string>, S extends SearchParams = SearchParams>(
  render: (params: P, search: S) => Promise<ReactNode>,
): ScreenPage<P> => {
  const once = cache((key: string): Promise<ReactNode> => {
    const { params, search } = JSON.parse(key) as { params: P; search: S };
    return render(params, search);
  });
  return async ({ params, searchParams }) =>
    once(JSON.stringify({ params: await params, search: await searchParams }));
};

/**
 * Issue #196: the layout of a route with a loading boundary. A layout renders outside its own segment's boundary, so on a
 * document request it renders the screen first and the stream starts only once the screen is ready: a not-found keeps
 * its 404 and a redirect stays a server redirect (ruling N1). The page then reuses that render. A client navigation or a
 * prefetch skips it, and the prefetched skeleton shows the moment the route is tapped.
 */
export const documentFirst = <P extends Record<string, string>>(page: ScreenPage<P>) =>
  async function DocumentFirstLayout({
    children,
    params,
  }: {
    readonly children: ReactNode;
    readonly params: Promise<P>;
  }) {
    if (await isDocumentRequest()) await page({ params, searchParams: requestSearchParams() });
    return children;
  };
