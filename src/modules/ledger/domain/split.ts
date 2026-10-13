import { domainError, err, map, ok, type Money, type Result } from "@/shared/kernel";
import type { Share } from "./transaction";

/**
 * HU-E4-07: EQUAL among chosen members. HU-E4-08: PERCENT in basis points (two decimals, summing to
 * 10000), EXACT amounts per member, or SHARES as positive integer units.
 */
export type SplitInput =
  | { readonly method: "EQUAL"; readonly participants: readonly { readonly memberId: string }[] }
  | {
      readonly method: "PERCENT";
      readonly participants: readonly { readonly memberId: string; readonly basisPoints: number }[];
    }
  | {
      readonly method: "EXACT";
      readonly participants: readonly { readonly memberId: string; readonly amount: Money }[];
    }
  | {
      readonly method: "SHARES";
      readonly participants: readonly { readonly memberId: string; readonly units: number }[];
    };

/** 100 % in basis points. */
const WHOLE = 10_000;

const invalid = (reason: string): Result<never> => err(domainError("InvalidSplit", { reason }));

const allocated = (amount: Money, weights: readonly number[]): Result<bigint[]> =>
  map(amount.allocate(weights), (parts) => parts.map((part) => part.minor));

/** Amounts per participant; `order` lists the participants' request indexes in join order. */
const amountsOf = (amount: Money, split: SplitInput, order: readonly number[]): Result<bigint[]> => {
  switch (split.method) {
    case "EQUAL":
      return allocated(
        amount,
        order.map(() => 1),
      );
    case "PERCENT": {
      const points = order.map((index) => split.participants[index]!.basisPoints);
      if (points.some((p) => !Number.isInteger(p) || p <= 0)) return invalid("percentNotPositive");
      if (points.reduce((a, b) => a + b, 0) !== WHOLE) return invalid("percentNotHundred");
      return allocated(amount, points);
    }
    case "SHARES": {
      const units = order.map((index) => split.participants[index]!.units);
      if (units.some((u) => !Number.isSafeInteger(u) || u <= 0)) return invalid("unitsNotPositive");
      return allocated(amount, units);
    }
    case "EXACT": {
      const parts = order.map((index) => split.participants[index]!.amount);
      const foreign = parts.find((part) => part.currency.code !== amount.currency.code);
      if (foreign !== undefined) {
        return err(
          domainError("CurrencyMismatch", { expected: amount.currency.code, actual: foreign.currency.code }),
        );
      }
      const minors = parts.map((part) => part.minor);
      if (minors.some((minor) => minor <= 0n)) return invalid("shareNotPositive");
      return minors.reduce((a, b) => a + b, 0n) === amount.minor
        ? ok(minors)
        : err(domainError("SharesDoNotMatchAmount"));
    }
  }
};

/**
 * HU-E4-07/08, spec 5.3: the shares of `amount` among the split's participants, who must be current
 * members (`memberIds`, in join order). Shares come back in join order, so the largest-remainder
 * rounding of Money.allocate gives leftover rounding units to the earliest-joined participants
 * whatever order the request used, and the shares always sum to `amount` exactly.
 */
export const splitShares = (
  amount: Money,
  split: SplitInput,
  memberIds: readonly string[],
): Result<Share[]> => {
  const ids = split.participants.map((participant) => participant.memberId);
  if (ids.length === 0) return err(domainError("ParticipantsRequired"));
  if (new Set(ids).size !== ids.length) return invalid("duplicateParticipant");
  if (ids.some((id) => !memberIds.includes(id))) return err(domainError("NotASpaceMember"));
  const order = ids
    .map((_, index) => index)
    .sort((a, b) => memberIds.indexOf(ids[a]!) - memberIds.indexOf(ids[b]!));
  const amounts = amountsOf(amount, split, order);
  if (!amounts.ok) return amounts;
  // shares_amount_positive: an amount too small to give everyone a positive share is rejected.
  if (amounts.value.some((part) => part <= 0n)) return invalid("shareNotPositive");
  return ok(
    order.map((index, position) => ({
      memberId: ids[index]!,
      amount: amounts.value[position]!,
      splitMethod: split.method,
    })),
  );
};
