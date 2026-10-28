/**
 * The browser's history of this tab, as the app saw it, so Volver can return to where the person actually was.
 *
 * `urls` holds one entry (pathname plus search) for every entry of the browser's own history that the app created,
 * and `pos` the one the person is on. Nothing else is needed: a push adds an entry (and drops the ones ahead), a
 * replace changes the current one (the form that saved is gone from the trail, as it is from the browser), and going
 * back or forward only moves `pos`. Volver goes to the nearest earlier entry on another screen, so a query changing on
 * one screen (a period, a filter) or a form replaced by its screen never takes a step of its own.
 *
 * The bottom navigation's destinations are roots: arriving at one restarts the trail, so switching tabs never builds a
 * chain. The sign-in, sign-up and invitation screens are never an earlier screen to return to.
 */
export interface Trail {
  readonly urls: readonly string[];
  readonly pos: number;
}

/** The browser keeps 50 entries; so does the trail. */
export const MAX_ENTRIES = 50;
const KEY = "hearth:navigation";
const NONE: Trail = { urls: [], pos: -1 };

/** The screen a URL is on: its pathname. A query changing on one screen is not a new screen. */
const screenOf = (url: string): string => url.split("?")[0]!;

/** Inicio, Movimientos, Plan and Saldos of a space, or "/". Registrar (`/spaces/:id/new`) is a form with its own Volver. */
const ROOT = /^\/(?:spaces\/(?!new$)[^/]+(?:\/(?:transactions|plan|balances))?)?$/;
export const isRootScreen = (url: string): boolean => ROOT.test(screenOf(url));

/** Screens a person passes through to get somewhere (or to join a space), never a screen to go back to. */
const AUTH = /^\/(?:sign-(?:in|up)|(?:invitations|claims)\/.)/;
export const isAuthScreen = (url: string): boolean => AUTH.test(screenOf(url));

/**
 * A new entry of the browser's history: the ones ahead are gone, and arriving at a root from another screen restarts
 * the trail. A push that only changes the query of the root the person is on (a sheet opened by `?tx=`) restarts
 * nothing: the entry before it is the screen itself, which closing the sheet goes back to (`cameFrom`).
 */
export const pushed = (trail: Trail, url: string): Trail => {
  const sameRoot = isRootScreen(url) && screenOf(trail.urls[trail.pos] ?? "") === screenOf(url);
  const urls =
    isRootScreen(url) && !sameRoot ? [url] : [...trail.urls.slice(0, trail.pos + 1), url].slice(-MAX_ENTRIES);
  return { urls, pos: urls.length - 1 };
};

/** The current entry takes another URL (`history.replaceState`): no step is added. */
export const replaced = (trail: Trail, url: string): Trail => {
  if (isRootScreen(url) || trail.pos < 0) return { urls: [url], pos: 0 };
  return { urls: trail.urls.with(trail.pos, url), pos: trail.pos };
};

/** The browser went back or forward to `url`: the nearest entry with it (back first), or a new trail if unknown. */
export const traversed = (trail: Trail, url: string): Trail => {
  const found = trail.urls
    .map((candidate, index) => (candidate === url ? index : -1))
    .filter((index) => index >= 0)
    .sort((a, b) => Math.abs(a - trail.pos) - Math.abs(b - trail.pos) || a - b)[0];
  return found === undefined || isRootScreen(url)
    ? { urls: [url], pos: 0 }
    : { urls: trail.urls, pos: found };
};

/**
 * How far the browser goes back to the nearest earlier entry on another screen, or null when that is none or a
 * sign-in or invitation screen. A trail that does not stand on `current` is stale and counts as none.
 */
export const stepsBack = (trail: Trail, current: string): number | null => {
  const screen = screenOf(current);
  if (screenOf(trail.urls[trail.pos] ?? "") !== screen) return null;
  for (let index = trail.pos - 1; index >= 0; index -= 1) {
    const url = trail.urls[index]!;
    if (screenOf(url) !== screen) return isAuthScreen(url) ? null : trail.pos - index;
  }
  return null;
};

/**
 * Volver's click: back in the browser, to the screen the person actually came from, when the trail knows of one; a
 * modified click (a new tab) is left to the browser. `history.go` is what `router.back()` calls, and it also skips the
 * screens of a flow in one step. Without a previous screen the link's own href applies.
 */
export const goBack = (
  event: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "preventDefault">,
): void => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const steps = stepsBack(readTrail(), window.location.pathname);
  if (steps === null) return;
  event.preventDefault();
  window.history.go(-steps);
};

/**
 * The entry before the current one, or null when there is none or the trail does not stand on `current` (a stale
 * trail). It tells a sheet opened by a push in this tab (go back to close it) from one opened by a typed URL.
 */
export const cameFrom = (trail: Trail, current: string): string | null =>
  trail.urls[trail.pos] === current ? (trail.urls[trail.pos - 1] ?? null) : null;

const valid = (value: unknown): value is Trail => {
  const { urls, pos } = (value ?? {}) as Partial<Trail>;
  return (
    Array.isArray(urls) &&
    urls.every((url) => typeof url === "string") &&
    Number.isInteger(pos) &&
    pos! >= 0 &&
    pos! < urls.length
  );
};

/** Even naming `sessionStorage` can throw, so every access sits in a try; blocked storage or garbage is no trail. */
export const readTrail = (storage?: Pick<Storage, "getItem">): Trail => {
  try {
    const parsed: unknown = JSON.parse((storage ?? sessionStorage).getItem(KEY) ?? "");
    if (valid(parsed)) return parsed;
  } catch {
    // Blocked storage, nothing stored yet and garbage are the same: Volver follows its href.
  }
  return NONE;
};

export const writeTrail = (trail: Trail, storage?: Pick<Storage, "setItem">): void => {
  try {
    (storage ?? sessionStorage).setItem(KEY, JSON.stringify(trail));
  } catch {
    // Private mode and a full quota throw: no trail, and Volver follows its href.
  }
};
