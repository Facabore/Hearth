import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import type { CurrencyAmount } from "./currency-amount";

/**
 * Spec 5.2 MemberCapacity: what a member, registered or guest (D15), puts in for the plan's period. Ruling P342 (S7):
 * one per member and currency ("Juan 2.400.000 COP y 100 USD"), never converted.
 */
export interface MemberCapacity {
  readonly memberId: string;
  readonly currency: string;
  /** Minor units of `currency`, never negative. */
  readonly amount: bigint;
}

/**
 * HU-E6-02: the capacities a request sets, for current members (`memberIds`), never negative. P342 (S7): in any
 * currency, one per member and currency; the pairs it does not list keep theirs, and listing a pair twice is ambiguous
 * and refused. Ruling P261 (#217): a VIEWER (`viewerIds`) never holds a capacity, so theirs may only be 0
 * (ViewerCannotHoldCapacity).
 */
export const checkedCapacities = (
  entries: readonly { readonly memberId: string; readonly amount: Money }[],
  memberIds: readonly string[],
  viewerIds: readonly string[],
): Result<MemberCapacity[]> => {
  const pairs = entries.map((e) => `${e.memberId} ${e.amount.currency.code}`);
  if (new Set(pairs).size !== entries.length) {
    return err(domainError("InvalidCapacity", { reason: "duplicateMember" }));
  }
  const checked: MemberCapacity[] = [];
  for (const entry of entries) {
    if (!memberIds.includes(entry.memberId)) return err(domainError("NotASpaceMember"));
    if (entry.amount.minor < 0n) return err(domainError("InvalidCapacity", { reason: "negative" }));
    if (entry.amount.minor > 0n && viewerIds.includes(entry.memberId)) {
      return err(domainError("ViewerCannotHoldCapacity", { memberId: entry.memberId }));
    }
    checked.push({
      memberId: entry.memberId,
      currency: entry.amount.currency.code,
      amount: entry.amount.minor,
    });
  }
  return ok(checked);
};

/** HU-E6-02: a member without an explicit capacity in `currency` counts as 0 in it. */
export const capacityOf = (
  capacities: readonly MemberCapacity[],
  memberId: string,
  currency: string,
): bigint => capacities.find((c) => c.memberId === memberId && c.currency === currency)?.amount ?? 0n;

/** HU-E6-02: Σ capacities in `currency` of the current members; a member who left keeps their row but no longer counts. */
export const totalCapacity = (
  capacities: readonly MemberCapacity[],
  memberIds: readonly string[],
  currency: string,
): bigint => memberIds.reduce((sum, memberId) => sum + capacityOf(capacities, memberId, currency), 0n);

/** P342 (S7): Σ capacities of the current members in each currency any of them holds a row in, alphabetically. */
export const totalCapacities = (
  capacities: readonly MemberCapacity[],
  memberIds: readonly string[],
): CurrencyAmount[] =>
  [...new Set(capacities.filter((c) => memberIds.includes(c.memberId)).map((c) => c.currency))]
    .sort()
    .map((currency) => ({ currency, amount: totalCapacity(capacities, memberIds, currency) }));

/**
 * `part` in basis points of `total`, rounded half up (36.75 % = 3675); null when there is no total.
 * Precondition: 0 <= part <= total, so the result is within 0..10000; it does not clamp other values.
 */
export const shareOfTotal = (part: bigint, total: bigint): number | null =>
  total <= 0n ? null : Number((part * 20_000n + total) / (2n * total));
