/** A SHARED_FUND line's assigned amounts: null on an invalid allocation, no members on a NONE line. */
export interface FundLine {
  readonly members: readonly { readonly memberId: string; readonly assigned: bigint | null }[];
}

export interface FundContribution {
  readonly memberId: string;
  readonly expected: bigint;
  readonly actual: bigint;
  /** actual − expected: negative while the member still has to pay in. */
  readonly difference: bigint;
}

/**
 * HU-E7-03, spec 5.4 fund level (ruling P36): expected(m) = Σ assigned(m) over the plan's SHARED_FUND lines, an
 * invalid or NONE line assigning nothing; actual(m) = Σ m's fund contributions in the period; for `memberIds` only.
 */
export const fundContributions = (
  memberIds: readonly string[],
  fundLines: readonly FundLine[],
  contributions: readonly { readonly memberId: string; readonly amount: bigint }[],
): FundContribution[] =>
  memberIds.map((memberId) => {
    const expected = fundLines.reduce(
      (sum, line) => sum + (line.members.find((m) => m.memberId === memberId)?.assigned ?? 0n),
      0n,
    );
    const actual = contributions
      .filter((c) => c.memberId === memberId)
      .reduce((sum, c) => sum + c.amount, 0n);
    return { memberId, expected, actual, difference: actual - expected };
  });
