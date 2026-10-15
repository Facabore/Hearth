import { domainError, err, flatMap, map, Money, ok, type Result } from "@/shared/kernel";
import type { AllocationRule, BudgetLine } from "./budget-line";

/** A member's value on a PERCENT line (basis points, 42 % = 4200) or a FIXED line (minor units). */
export interface AllocationValue {
  readonly memberId: string;
  readonly value: bigint;
}

/** HU-E6-05: a current allocation value of one of the plan's lines. */
export interface LineAllocation extends AllocationValue {
  readonly lineId: string;
}

/** HU-E6-05: how a line is allocated among members. */
export type AllocationInput =
  | { readonly rule: "PROPORTIONAL" }
  | { readonly rule: "NONE" }
  | {
      readonly rule: "PERCENT";
      readonly members: readonly { readonly memberId: string; readonly basisPoints: number }[];
    }
  | {
      readonly rule: "FIXED";
      readonly members: readonly { readonly memberId: string; readonly amount: Money }[];
    };

/** 100 % in basis points. */
const WHOLE = 10_000n;

const invalid = (reason: string): Result<never> => err(domainError("InvalidAllocation", { reason }));
const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);

/**
 * HU-E6-05: the rule and the member values a line stores, in join order. PERCENT values sum to 100 % and FIXED
 * amounts to the planned amount, each positive, for current members (registered or guest, D15); PROPORTIONAL and
 * NONE store no values.
 */
export const checkedAllocation = (
  input: AllocationInput,
  line: Pick<BudgetLine, "plannedAmount">,
  memberIds: readonly string[],
  currency: string,
): Result<{ rule: AllocationRule; values: AllocationValue[] }> => {
  if (input.rule === "PROPORTIONAL" || input.rule === "NONE") return ok({ rule: input.rule, values: [] });
  const ids = input.members.map((m) => m.memberId);
  if (ids.length === 0) return invalid("membersRequired");
  if (new Set(ids).size !== ids.length) return invalid("duplicateMember");
  if (ids.some((id) => !memberIds.includes(id))) return err(domainError("NotASpaceMember"));
  let values: AllocationValue[];
  if (input.rule === "PERCENT") {
    if (input.members.some((m) => !Number.isInteger(m.basisPoints) || m.basisPoints <= 0)) {
      return invalid("percentNotPositive");
    }
    values = input.members.map((m) => ({ memberId: m.memberId, value: BigInt(m.basisPoints) }));
    if (sum(values.map((v) => v.value)) !== WHOLE) return invalid("percentNotHundred");
  } else {
    const foreign = input.members.find((m) => m.amount.currency.code !== currency);
    if (foreign !== undefined) {
      return err(
        domainError("CurrencyMismatch", { expected: currency, actual: foreign.amount.currency.code }),
      );
    }
    if (input.members.some((m) => m.amount.minor <= 0n)) return invalid("amountNotPositive");
    values = input.members.map((m) => ({ memberId: m.memberId, value: m.amount.minor }));
    if (sum(values.map((v) => v.value)) !== line.plannedAmount) return invalid("fixedNotPlanned");
  }
  const inJoinOrder = [...values].sort(
    (a, b) => memberIds.indexOf(a.memberId) - memberIds.indexOf(b.memberId),
  );
  return ok({ rule: input.rule, values: inJoinOrder });
};

const allocated = (total: bigint, currency: string, weights: readonly bigint[]): Result<bigint[]> =>
  flatMap(Money.ofMinor(total, currency), (money) =>
    map(money.allocate(weights), (parts) => parts.map((part) => part.minor)),
  );

/**
 * HU-E6-05, spec 5.3: what each current member (join order) is assigned on a line, derived on read and never
 * stored; null for NONE. PROPORTIONAL follows capacities, PERCENT and FIXED the values of current members, so a
 * line with a value of a member who left (ruling P7), values that do not add up, or no capacity to follow, is
 * InvalidAllocation until it is allocated again.
 * Only weighted members share the planned amount, so the others get 0 and never a rounding remainder.
 */
export const assignedAmounts = (
  line: Pick<BudgetLine, "allocationRule" | "plannedAmount">,
  values: readonly AllocationValue[],
  members: readonly { readonly memberId: string; readonly capacity: bigint }[],
  currency: string,
): Result<{ memberId: string; amount: bigint }[] | null> => {
  const rule = line.allocationRule;
  if (rule === "NONE") return ok(null);
  // Ruling P7: a row naming a member who left flags the line until it is allocated again, whatever the sums say.
  if (rule !== "PROPORTIONAL" && values.some((v) => !members.some((m) => m.memberId === v.memberId))) {
    return invalid("formerMember");
  }
  const valueOf = (memberId: string) => values.find((v) => v.memberId === memberId)?.value ?? 0n;
  const weights = members.map((m) => ({
    memberId: m.memberId,
    weight: rule === "PROPORTIONAL" ? m.capacity : valueOf(m.memberId),
  }));
  const total = sum(weights.map((w) => w.weight));
  if (rule === "FIXED") {
    return total === line.plannedAmount
      ? ok(weights.map((w) => ({ memberId: w.memberId, amount: w.weight })))
      : invalid("fixedNotPlanned");
  }
  if (rule === "PERCENT" && total !== WHOLE) return invalid("percentNotHundred");
  const weighted = weights.filter((w) => w.weight > 0n);
  if (weighted.length === 0) return invalid("noCapacity");
  return map(
    allocated(
      line.plannedAmount,
      currency,
      weighted.map((w) => w.weight),
    ),
    (parts) =>
      weights.map((w) => {
        const index = weighted.indexOf(w);
        return { memberId: w.memberId, amount: index < 0 ? 0n : parts[index]! };
      }),
  );
};
