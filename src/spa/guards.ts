import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import type { MeDto } from "@/shared/ui/api/dto";
import { nextFromPath, redirectFor } from "@/shared/ui/navigation/auth-redirect";
import type { SpaApis } from "./api";
import { meQuery, queryKeys } from "./queries";

/** What every route's `beforeLoad` and `loader` receive (ADR 0006). */
export interface RouterContext {
  readonly queryClient: QueryClient;
  readonly apis: SpaApis;
}

interface Where {
  readonly pathname: string;
  readonly searchStr: string;
}

const kept = (key: readonly unknown[]) =>
  key[0] === "i18n" ||
  [queryKeys.me, queryKeys.signUpMode].some((own) => own.every((part, i) => key[i] === part));

/**
 * The profile read again from the API. When the person changed (signed out, or someone else signed in on this device)
 * every other answer in the cache belonged to the previous person, so it is dropped before anything paints from it.
 */
const freshMe = async ({ queryClient, apis }: RouterContext): Promise<MeDto | null> => {
  const before = queryClient.getQueryData(meQuery(apis.sessionApi).queryKey);
  const me = await queryClient.fetchQuery({ ...meQuery(apis.sessionApi), staleTime: 0 });
  if ((before?.id ?? null) !== (me?.id ?? null))
    queryClient.removeQueries({ predicate: (query) => !kept(query.queryKey) });
  return me;
};

/**
 * Whether the person is signed in. Navigation never pays a round trip for a session it already knows lets the person
 * through: a cached answer is taken as it is only when it is the one `passingWhen` names, the one that lets the guard
 * pass. The other answer leads to a redirect, which is decided only on a fresh read, so a sign-in or a sign-out that
 * just happened is never undone by a stale one.
 */
const isSignedIn = async (
  context: RouterContext,
  { passingWhen }: { readonly passingWhen: "signed-in" | "signed-out" },
): Promise<boolean> => {
  const cached = context.queryClient.getQueryData(meQuery(context.apis.sessionApi).queryKey);
  if (cached !== undefined && (cached === null ? "signed-out" : "signed-in") === passingWhen)
    return cached !== null;
  return (await freshMe(context)) !== null;
};

/**
 * `src/proxy.ts` in the SPA (HU-E9-01): a protected path without a session goes to the sign-in screen with the path to
 * return to. Public, open and icon paths (`redirectFor`'s rules) pass without reading the session. A guard is only
 * navigation: the API still authorizes every request.
 */
export const guardSession = async (context: RouterContext, where: Where): Promise<void> => {
  const target = redirectFor({ pathname: where.pathname, search: where.searchStr, hasSession: false });
  if (target !== null && !(await isSignedIn(context, { passingWhen: "signed-in" })))
    throw redirect({ href: target });
};

/**
 * The public layout (HU-E9-01, N4, ruling P145): a signed-in person goes to the screen `next` names, made safe, instead
 * of the form.
 */
export const leaveWhenSignedIn = async (context: RouterContext, where: Where): Promise<void> => {
  if (await isSignedIn(context, { passingWhen: "signed-out" }))
    throw redirect({ href: nextFromPath(`${where.pathname}${where.searchStr}`), replace: true });
};
