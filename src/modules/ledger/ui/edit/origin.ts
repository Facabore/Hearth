import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { withoutTx } from "../detail/tx-href";

/**
 * Ruling P191: an edit returns to the list or home of its own space it was opened from (the sheet's `returnTo`);
 * anything else, a missing or unsafe value, another space's address or a path that leaves the space, returns to the
 * list.
 */
export const originOf = (returnTo: string | undefined, spaceId: string): string => {
  const fallback = `/spaces/${spaceId}/transactions`;
  const safe = safeReturnTo(returnTo);
  if (safe === null) return fallback;
  // The URL parser resolves dot segments the way the browser will, so "/spaces/s-1/../s-2" is seen as space 2.
  const { pathname } = new URL(safe, "http://hearth.invalid");
  const own = `/spaces/${spaceId}`;
  return pathname === own || pathname.startsWith(`${own}/`) ? withoutTx(safe) : fallback;
};
