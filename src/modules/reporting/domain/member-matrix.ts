/** HU-E7-02 (ruling P35): why some figures of a line's row are null. */
export const MATRIX_REASONS = ["NOT_ALLOCATED", "TRACKED_AT_FUND_LEVEL", "INVALID_ALLOCATION"] as const;
export type MatrixReason = (typeof MATRIX_REASONS)[number];

/** HU-E7-02: the sign of the gap; positive means the member over-contributed (spec 5.4). */
export const GAP_STATUSES = ["OVER_CONTRIBUTED", "UNDER_CONTRIBUTED", "ON_TARGET"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

/** What the plan and the ledger give one line for one period. */
export interface LineSums {
  readonly funding: "DIRECT" | "SHARED_FUND" | "SAVINGS";
  /** False for the rule NONE: group money without per-member responsibility (D13). */
  readonly allocated: boolean;
  /** HU-E6-05: the allocation does not hold, so nobody has an assigned amount. */
  readonly invalid: boolean;
  /** Every current member in join order (ruling P7). */
  readonly members: readonly {
    readonly memberId: string;
    readonly assigned: bigint | null;
    /** DIRECT: Σ the member's payments of the line's expenses; SAVINGS: Σ transfers into their accounts on the line. */
    readonly contributed: bigint;
    /** Σ the member's shares of the line's expenses. */
    readonly consumed: bigint;
  }[];
}

export interface MatrixCell {
  readonly memberId: string;
  readonly assigned: bigint | null;
  readonly contributed: bigint | null;
  readonly consumed: bigint | null;
  /** contributed − assigned. */
  readonly gap: bigint | null;
  readonly status: GapStatus | null;
}

export interface MatrixRow {
  /** Null when the line is allocated, valid and tracked per member. */
  readonly reason: MatrixReason | null;
  readonly members: readonly MatrixCell[];
}

/** #213: one member's gap over the whole plan, and its sign. */
export interface MemberTotal {
  readonly memberId: string;
  /** Σ the member's gaps on the lines that give one; null when no line does. */
  readonly gap: bigint | null;
  readonly status: GapStatus | null;
}

export const gapStatus = (gap: bigint): GapStatus =>
  gap > 0n ? "OVER_CONTRIBUTED" : gap < 0n ? "UNDER_CONTRIBUTED" : "ON_TARGET";

const reasonOf = (line: LineSums): MatrixReason | null => {
  if (!line.allocated) return "NOT_ALLOCATED";
  if (line.funding === "SHARED_FUND") return "TRACKED_AT_FUND_LEVEL";
  return line.invalid ? "INVALID_ALLOCATION" : null;
};

/**
 * HU-E7-02, spec 5.4 (ruling P35): one line's row. A NONE line reports consumption only; a SHARED_FUND line leaves
 * contribution and gap to the fund (D5); an invalid allocation assigns nobody, so it has no gap; a SAVINGS line has
 * no consumption (its spending is transfers, not shares).
 */
export const matrixRow = (line: LineSums): MatrixRow => {
  const reason = reasonOf(line);
  const contributes = reason === null || reason === "INVALID_ALLOCATION";
  return {
    reason,
    members: line.members.map((m) => {
      const assigned = line.allocated && !line.invalid ? m.assigned : null;
      const gap = reason === null && assigned !== null ? m.contributed - assigned : null;
      return {
        memberId: m.memberId,
        assigned,
        contributed: contributes ? m.contributed : null,
        consumed: line.funding === "SAVINGS" ? null : m.consumed,
        gap,
        status: gap === null ? null : gapStatus(gap),
      };
    }),
  };
};

/**
 * #213 (ruling P262): each member's total gap, Σ of their gaps on the lines that give one, computed on read (D7) so a
 * client never adds the rows up (ruling P201). Lines without a gap (rule NONE, fund level, an invalid allocation, no
 * amount assigned) add nothing; a member none of them gives a gap has a null total.
 */
export const memberTotals = (memberIds: readonly string[], rows: readonly MatrixRow[]): MemberTotal[] =>
  memberIds.map((memberId) => {
    const gaps = rows.flatMap((row) =>
      row.members.flatMap((cell) => (cell.memberId === memberId && cell.gap !== null ? [cell.gap] : [])),
    );
    if (gaps.length === 0) return { memberId, gap: null, status: null };
    const gap = gaps.reduce((sum, value) => sum + value, 0n);
    return { memberId, gap, status: gapStatus(gap) };
  });
