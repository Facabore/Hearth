// Apart from history.ts, so the single-page app can declare its base at start without loading the trail.

let appBase = "";

/** The single-page app lives under a base path (`/app`, ADR 0006) and declares it once at start; the Next.js UI has none. */
export const setAppBase = (base: string): void => {
  appBase = base;
};

/**
 * The browser's address as the app's own paths read it: without the base, so the trail, Volver and the detail sheet
 * compare the same paths the screens link to.
 */
export const appLocation = (
  location: Pick<Location, "pathname" | "search"> = window.location,
): { pathname: string; search: string } => {
  const { pathname, search } = location;
  const inside = appBase !== "" && (pathname === appBase || pathname.startsWith(`${appBase}/`));
  return { pathname: inside ? pathname.slice(appBase.length) || "/" : pathname, search };
};
