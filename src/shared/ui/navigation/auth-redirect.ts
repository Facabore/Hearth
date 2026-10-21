/** HU-E9-01: the screens a visitor without a session may open. */
export const PUBLIC_PATHS = ["/sign-in", "/sign-up"] as const;

const isPublic = (pathname: string) =>
  PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}?`));

/**
 * The app's icons (Next's file-based metadata: `src/app/icon.svg`, `apple-icon.png`). Browsers fetch them with no
 * regard for the session, on the sign-in screen first, so they are exact matches that never redirect.
 */
export const ICON_PATHS = ["/icon.svg", "/apple-icon.png"] as const;

/**
 * Ruling P157: pages a visitor opens with or without a session (an invitation, a claim link). The proxy lets them
 * through; unlike the public screens they are valid `next` targets, and a signed-in person stays on them.
 */
export const OPEN_PREFIXES = ["/invitations/", "/claims/"] as const;

/**
 * An open path is a prefix and exactly one token segment: nothing deeper, no dot segment and no backslash, so the
 * prefix can never open a protected page whatever the URL parser later does with the rest.
 */
export const isOpenPath = (pathname: string): boolean =>
  OPEN_PREFIXES.some((prefix) => {
    if (!pathname.startsWith(prefix)) return false;
    const token = pathname.slice(prefix.length);
    return token !== "" && token !== "." && token !== ".." && !token.includes("/") && !token.includes("\\");
  });

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
  if (
    input.hasSession ||
    isPublic(input.pathname) ||
    isOpenPath(input.pathname) ||
    (ICON_PATHS as readonly string[]).includes(input.pathname)
  )
    return null;
  const target = `${input.pathname}${input.search}`;
  return target === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(target)}`;
};

/**
 * Ruling P151: where the browser goes when a call answers 401 on a page that looked signed in. `next` is the page it
 * was on (path and query); `expired=1` only makes the sign-in screen say why, `safeNext` never reads it.
 */
export const expiredSignInUrl = (current: { pathname: string; search: string }): string =>
  `/sign-in?next=${encodeURIComponent(`${current.pathname}${current.search}`)}&expired=1`;
