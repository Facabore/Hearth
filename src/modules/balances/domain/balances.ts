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

/** HU-E5-03: one suggested payment; accepting it is a regular settlement (HU-E5-02). */
export interface SettlementSuggestion {
  readonly payerMemberId: string;
  readonly receivingMemberId: string;
  /** Minor units, always positive. */
  readonly amount: bigint;
}

/**
 * HU-E5-03 DebtSimplifier: while someone is owed money, the member who owes the most pays the member owed
 * the most as much as one of them still needs. Each payment settles at least one of the two, so n members
 * need at most n − 1 payments, and each member pays or receives exactly their net. Ties go to the member
 * listed first (join order), so the same balances always give the same suggestions. Greedy: few payments,
 * not always the fewest possible. Nets that do not sum to zero (never the balances of a space) are settled as
 * far as they go: it stops when no creditor or no debtor is left, and the surplus of the other side stays unpaid.
 */
export const simplifyDebts = (balances: readonly MemberBalance[]): SettlementSuggestion[] => {
  const open = balances.map((b, order) => ({ memberId: b.memberId, net: b.net, order }));
  /** The open member furthest from zero on the side `sign` (1n: owed money, -1n: owes money). */
  const largest = (sign: bigint) =>
    open
      .filter((m) => m.net * sign > 0n)
      .sort((a, b) => {
        const difference = b.net * sign - a.net * sign;
        return difference === 0n ? a.order - b.order : difference > 0n ? 1 : -1;
      })[0];
  const suggestions: SettlementSuggestion[] = [];
  for (;;) {
    const creditor = largest(1n);
    const debtor = largest(-1n);
    if (!creditor || !debtor) return suggestions;
    const amount = creditor.net < -debtor.net ? creditor.net : -debtor.net;
    suggestions.push({ payerMemberId: debtor.memberId, receivingMemberId: creditor.memberId, amount });
    creditor.net -= amount;
    debtor.net += amount;
  }
};
