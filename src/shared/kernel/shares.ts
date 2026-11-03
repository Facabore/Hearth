import { domainError } from "./domain-error";
import { err, ok, type Result } from "./result";

/**
 * Spec 5.3, shares_amount_positive: every share of a split, in minor units, is positive. An amount too small to give
 * each participant one answers InvalidSplit (`shareNotPositive`), whether a member records the split or previews the
 * default one (ruling P285).
 */
export const positiveShares = <T extends readonly bigint[]>(parts: T): Result<T> =>
  parts.some((part) => part <= 0n)
    ? err(domainError("InvalidSplit", { reason: "shareNotPositive" }))
    : ok(parts);

/** Who a default split names, and the VIEWERs it leaves out (ruling P293). */
export interface DefaultSplitMembers {
  /** Every current member but the VIEWERs, guests included (D15), in the order given (join order). */
  readonly memberIds: readonly string[];
  /** The current VIEWERs: they take part in no default, but a figure they stored before still holds a line (P263). */
  readonly viewerIds: readonly string[];
}

/**
 * Spec 5.3, ruling P293: a Lector (VIEWER) stays out of the default split, EQUAL and BY_ALLOCATION alike, whether a
 * member records an expense without a split or previews its default. A split the recorder chooses may still name one.
 * A guest has no role and stays in.
 */
export const defaultSplitMembers = (
  members: readonly { readonly id: string; readonly role: string | null }[],
): DefaultSplitMembers => ({
  memberIds: members.filter((m) => m.role !== "VIEWER").map((m) => m.id),
  viewerIds: members.filter((m) => m.role === "VIEWER").map((m) => m.id),
});
