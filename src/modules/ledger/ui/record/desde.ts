import type { AccountUsageDto } from "@/shared/ui/api/dto";
import { safeReturnTo } from "@/shared/ui/navigation/auth-redirect";

/**
 * Ruling P337: the account whose own screen (`/spaces/:spaceId/accounts/:accountId`, #315) the form was opened from, by
 * the `returnTo` it carries; null from any other screen. Whether "Desde" offers it is the form's to check.
 */
export const accountOfScreen = (returnTo: string | null | undefined, spaceId: string): string | null => {
  const path = safeReturnTo(returnTo)?.split(/[?#]/)[0];
  const prefix = `/spaces/${spaceId}/accounts/`;
  if (!path?.startsWith(prefix)) return null;
  const id = path.slice(prefix.length).split("/")[0] ?? "";
  return id === "" || id === "new" ? null : id;
};

/**
 * Ruling P337: the account the person last paid an expense of `categoryId` from (its leaf: the subcategory when there
 * is one), while it is one of `offered`; else null.
 */
export const learnedAccount = (
  usage: AccountUsageDto | null | undefined,
  categoryId: string | null,
  offered: readonly { readonly id: string }[],
): string | null => {
  if (!usage || categoryId === null) return null;
  const accountId = usage.categories.find((c) => c.categoryId === categoryId)?.accountId;
  return accountId !== undefined && offered.some((a) => a.id === accountId) ? accountId : null;
};
