"use client";

import { useEffect } from "react";
import {
  appLocation,
  goBack,
  pushed,
  readTrail,
  replaced,
  traversed,
  writeTrail,
  type Trail,
} from "./history";

const here = () => {
  const { pathname, search } = appLocation();
  return `${pathname}${search}`;
};

/** A page opened by a typed URL or an outside link is a new start; a reload or a Back/Forward load continues the walk. */
const openedByUrl = () =>
  (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type ===
  "navigate";

/**
 * Mounted once in the app layout: keeps the trail of this tab's browser history (`history.ts`), so Volver can return
 * to where the person was. The router changes the history only through `pushState` and `replaceState`, and the
 * browser's Back and Forward (and a Volver that goes back) arrive as `popstate`; each is recorded with the URL the
 * browser ends up at, so every entry counts, whatever changed in it: the path or only the query. It also gives a route's
 * skeleton its Volver (#196): the skeleton is server markup with a plain link marked `data-back`, and a click on it goes
 * back here the way `ScreenHeader`'s does, with no script of its own on any route.
 */
export function NavigationTracker() {
  useEffect(() => {
    const record = (change: (trail: Trail, url: string) => Trail) => writeTrail(change(readTrail(), here()));
    const trail = readTrail();
    writeTrail(openedByUrl() || trail.urls[trail.pos] !== here() ? { urls: [here()], pos: 0 } : trail);

    const { pushState, replaceState } = window.history;
    const push: History["pushState"] = function (this: History, ...args) {
      const result = pushState.apply(this, args);
      record(pushed);
      return result;
    };
    const replace: History["replaceState"] = function (this: History, ...args) {
      const result = replaceState.apply(this, args);
      if (here() !== readTrail().urls[readTrail().pos]) record(replaced);
      return result;
    };
    const onPop = () => record(traversed);
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("a[data-back]")) goBack(event);
    };
    window.history.pushState = push;
    window.history.replaceState = replace;
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
      if (window.history.pushState === push) window.history.pushState = pushState;
      if (window.history.replaceState === replace) window.history.replaceState = replaceState;
    };
  }, []);
  return null;
}
