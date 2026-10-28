import type { useRouter } from "next/navigation";
import { appLocation, cameFrom, readTrail } from "@/shared/ui/navigation/history";

/**
 * Ruling P189: leaves the detail sheet for `origin`, the list under it, without adding a history entry. A sheet opened
 * by a push from that list goes back to it, so Back then leaves the list to where the person was; a deep link or a
 * reload has no such entry, so its entry is replaced. `then` runs once the list is the current page: at once after a
 * replace, on the browser's `popstate` after a back (the router has not traversed before that).
 */
export const leaveSheet = (router: ReturnType<typeof useRouter>, origin: string, then?: () => void): void => {
  const { pathname, search } = appLocation();
  const here = `${pathname}${search}`;
  if (cameFrom(readTrail(), here) === origin) {
    if (then) window.addEventListener("popstate", then, { once: true });
    router.back();
  } else {
    router.replace(origin, { scroll: false });
    then?.();
  }
};
