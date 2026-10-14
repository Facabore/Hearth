/** Per-member sums over the live transactions of one space that move balances (E5 balance rule). */
export interface MemberTotals {
  readonly memberId: string;
  /** Σ payments by the member on member-paid expenses. */
  readonly paid: bigint;
  /** Σ shares of the member on member-paid expenses. */
  readonly consumed: bigint;
  /** Σ settlements the member paid. */
  readonly settledOut: bigint;
  /** Σ settlements the member received. */
  readonly settledIn: bigint;
}

export interface MemberBalance {
  readonly memberId: string;
  /** Positive: the member is owed money; negative: the member owes. */
  readonly net: bigint;
}

/** E5 balance rule: net(m) = Σ payments − Σ shares + settlements paid − settlements received. */
export const netOf = (totals: MemberTotals): bigint =>
  totals.paid - totals.consumed + totals.settledOut - totals.settledIn;

/**
 * HU-E5-01: one balance per current member in join order (0 when nothing moved it), then anyone else
 * the totals mention, by id, so the balances of a space always sum to zero.
 */
export const netBalances = (
  memberIds: readonly string[],
  totals: readonly MemberTotals[],
): MemberBalance[] => {
  const byMember = new Map(totals.map((t) => [t.memberId, netOf(t)]));
  const others = [...byMember.keys()].filter((id) => !memberIds.includes(id)).sort();
  return [...memberIds, ...others].map((memberId) => ({ memberId, net: byMember.get(memberId) ?? 0n }));
};
