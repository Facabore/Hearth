/**
 * Ruling P337 (#334): the accounts the person used most in the last 90 days first, as the server ranks them
 * (`GET /me/account-usage`); the ones not used keep the order they came in (by name). Without an answer, as given.
 */
export const byUse = <A extends { readonly id: string }>(
  accounts: readonly A[],
  ranked: readonly { readonly accountId: string }[] | undefined,
): A[] => {
  if (!ranked || ranked.length === 0) return [...accounts];
  const rank = new Map(ranked.map((use, index) => [use.accountId, index]));
  const at = (account: A) => rank.get(account.id) ?? ranked.length;
  // A stable sort: the unused, all at the same rank, keep their order.
  return [...accounts].sort((a, b) => at(a) - at(b));
};
