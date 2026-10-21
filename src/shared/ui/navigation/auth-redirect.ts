/** HU-E9-01: the screens a visitor without a session may open. */
export const PUBLIC_PATHS = ["/sign-in", "/sign-up"] as const;

const isPublic = (pathname: string) =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}?`));

/** The URL parser drops tabs and newlines and reads "\" as "/", so "/\t/evil.example" would leave the origin. */
const bends = (c: string) => c === "\\" || c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;

/** Ruling P125: only a same-origin path is honoured as `next`; anything else, or a public screen, lands on "/". */
export const safeNext = (next: string | null | undefined): string => {
  if (!next || !next.startsWith("/") || next.startsWith("//") || [...next].some(bends)) return "/";
  return isPublic(next.split("?")[0] ?? "") ? "/" : next;
};

/**
 * The proxy's optimistic check (a cookie, not a session lookup): a protected path without a session cookie goes to the
 * sign-in screen with the path to return to. An expired cookie passes here and is caught by the shell (Task 9).
 */
export const redirectFor = (input: {
  pathname: string;
  search: string;
  hasSession: boolean;
}): string | null => {
  if (input.hasSession || isPublic(input.pathname)) return null;
  const target = `${input.pathname}${input.search}`;
  return target === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(target)}`;
};

/**
 * Ruling P151: where the browser goes when a call answers 401 on a page that looked signed in. `next` is the page it
 * was on (path and query); `expired=1` only makes the sign-in screen say why, `safeNext` never reads it.
 */
export const expiredSignInUrl = (current: { pathname: string; search: string }): string =>
  `/sign-in?next=${encodeURIComponent(`${current.pathname}${current.search}`)}&expired=1`;
