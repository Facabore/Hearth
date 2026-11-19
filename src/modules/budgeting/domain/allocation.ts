import { domainError, err, flatMap, map, Money, ok, type Result } from "@/shared/kernel";
import type { AllocationRule, BudgetLine } from "./budget-line";
import type { CurrencyAmount } from "./currency-amount";

/**
 * A member's value on a PERCENT line (basis points, 42 % = 4200) or a FIXED line (minor units of `currency`). Ruling
 * P342 (S7, "Misma regla, por moneda"): a PERCENT value holds for every currency of the line (`currency` null); a FIXED
 * one is one budget's, so a member holds one per currency.
 */
export interface AllocationValue {
  readonly memberId: string;
  readonly currency: string | null;
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

const invalid = (reason: string, currency?: string): Result<never> =>
  err(domainError("InvalidAllocation", currency === undefined ? { reason } : { reason, currency }));
const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n);

/** Ruling P261: the refusal for the first value above zero that names a VIEWER, if any. */
const viewerIn = (
  values: readonly AllocationValue[],
  viewerIds: readonly string[],
): Result<never> | undefined => {
  const held = values.find((v) => v.value > 0n && viewerIds.includes(v.memberId));
  return held === undefined
    ? undefined
    : err(domainError("ViewerCannotHoldAllocation", { memberId: held.memberId }));
};

/**
 * HU-E6-05: the rule and the member values a line stores, in join order. PERCENT values sum to 100 % and FIXED
 * amounts to the planned amount, each positive, for current members (registered or guest, D15); PROPORTIONAL and
 * NONE store no values. Ruling P261 (#217): a VIEWER (`viewerIds`) never holds an allocation, and every stored value
 * is positive, so a value for one is refused (ViewerCannotHoldAllocation). Ruling P342 (S7, "Misma regla, por
 * moneda"): one PERCENT share per member serves every budget of the line; FIXED amounts are typed per budget, in the
 * line's own currencies only (CurrencyMismatch), at most one per member and currency, and each budget's add up to it.
 */
export const checkedAllocation = (
  input: AllocationInput,
  line: Pick<BudgetLine, "budgets">,
  memberIds: readonly string[],
  viewerIds: readonly string[],
): Result<{ rule: AllocationRule; values: AllocationValue[] }> => {
  if (input.rule === "PROPORTIONAL" || input.rule === "NONE") return ok({ rule: input.rule, values: [] });
  const ids = input.members.map((m) => m.memberId);
  if (ids.length === 0) return invalid("membersRequired");
  const keys =
    input.rule === "PERCENT" ? ids : input.members.map((m) => `${m.memberId} ${m.amount.currency.code}`);
  if (new Set(keys).size !== keys.length) return invalid("duplicateMember");
  if (ids.some((id) => !memberIds.includes(id))) return err(domainError("NotASpaceMember"));
  let values: AllocationValue[];
  if (input.rule === "PERCENT") {
    if (input.members.some((m) => !Number.isInteger(m.basisPoints) || m.basisPoints <= 0)) {
      return invalid("percentNotPositive");
    }
    values = input.members.map((m) => ({
      memberId: m.memberId,
      currency: null,
      value: BigInt(m.basisPoints),
    }));
    const viewer = viewerIn(values, viewerIds);
    if (viewer !== undefined) return viewer;
    if (sum(values.map((v) => v.value)) !== WHOLE) return invalid("percentNotHundred");
  } else {
    const currencies = line.budgets.map((b) => b.currency);
    const foreign = input.members.find((m) => !currencies.includes(m.amount.currency.code));
    if (foreign !== undefined) {
      return err(
        domainError("CurrencyMismatch", {
          expected: currencies.join(","),
          actual: foreign.amount.currency.code,
        }),
      );
    }
    if (input.members.some((m) => m.amount.minor <= 0n)) return invalid("amountNotPositive");
    values = input.members.map((m) => ({
      memberId: m.memberId,
      currency: m.amount.currency.code,
      value: m.amount.minor,
    }));
    const viewer = viewerIn(values, viewerIds);
    if (viewer !== undefined) return viewer;
    for (const budget of line.budgets) {
      const typed = values.filter((v) => v.currency === budget.currency).map((v) => v.value);
      if (sum(typed) !== budget.amount) return invalid("fixedNotPlanned", budget.currency);
    }
  }
  const currencyIndex = (c: string | null) => line.budgets.findIndex((b) => b.currency === c);
  const inJoinOrder = [...values].sort(
    (a, b) =>
      memberIds.indexOf(a.memberId) - memberIds.indexOf(b.memberId) ||
      currencyIndex(a.currency) - currencyIndex(b.currency),
  );
  return ok({ rule: input.rule, values: inJoinOrder });
};

const allocated = (total: bigint, currency: string, weights: readonly bigint[]): Result<bigint[]> =>
  flatMap(Money.ofMinor(total, currency), (money) =>
    map(money.allocate(weights), (parts) => parts.map((part) => part.minor)),
  );

/**
 * HU-E6-05, spec 5.3: what each current member (join order) is assigned of one budget of a line (`planned`), derived
 * on read and never stored; null for NONE. PROPORTIONAL follows capacities, PERCENT and FIXED the values of current
 * members, so a line with a value of a member who left (ruling P7), values that do not add up, or no capacity to
 * follow, is InvalidAllocation until it is allocated again.
 * Only weighted members share the planned amount, so the others get 0 and never a rounding remainder.
 * Ruling P342 (S7): per currency. `members` carry their capacity in `planned.currency` and `values` are the line's
 * PERCENT shares or its FIXED amounts in that currency.
 */
export const assignedAmounts = (
  rule: AllocationRule,
  planned: CurrencyAmount,
  values: readonly AllocationValue[],
  members: readonly { readonly memberId: string; readonly capacity: bigint }[],
): Result<{ memberId: string; amount: bigint }[] | null> => {
  const { currency, amount: plannedAmount } = planned;
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
    return total === plannedAmount
      ? ok(weights.map((w) => ({ memberId: w.memberId, amount: w.weight })))
      : invalid("fixedNotPlanned");
  }
  if (rule === "PERCENT" && total !== WHOLE) return invalid("percentNotHundred");
  const weighted = weights.filter((w) => w.weight > 0n);
  if (weighted.length === 0) return invalid("noCapacity");
  return map(
    allocated(
      plannedAmount,
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
