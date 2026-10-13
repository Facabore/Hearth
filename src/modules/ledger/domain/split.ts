import { domainError, err, map, ok, type Money, type Result } from "@/shared/kernel";
import type { Share } from "./transaction";

/** HU-E4-07: how an expense is shared among chosen members. HU-E4-08 adds PERCENT, EXACT and SHARES. */
export type SplitInput = {
  readonly method: "EQUAL";
  readonly participants: readonly { readonly memberId: string }[];
};

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
  }
};

/**
 * HU-E4-07, spec 5.3: the shares of `amount` among the split's participants, who must be current
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
