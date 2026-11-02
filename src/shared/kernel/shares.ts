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
