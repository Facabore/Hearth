import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";

/** Spec 5.2 MemberCapacity: what a member, registered or guest (D15), puts in for the plan's period. */
export interface MemberCapacity {
  readonly memberId: string;
  /** Minor units of the space currency, never negative. */
  readonly amount: bigint;
}

/**
 * HU-E6-02: the capacities a request sets, for current members (`memberIds`), in the space currency and never
 * negative. Members it does not list keep theirs; listing a member twice is ambiguous and refused. Ruling P261 (#217):
 * a VIEWER (`viewerIds`) never holds a capacity, so theirs may only be 0 (ViewerCannotHoldCapacity).
 */
export const checkedCapacities = (
  entries: readonly { readonly memberId: string; readonly amount: Money }[],
  memberIds: readonly string[],
  currency: string,
  viewerIds: readonly string[],
): Result<MemberCapacity[]> => {
  if (new Set(entries.map((e) => e.memberId)).size !== entries.length) {
    return err(domainError("InvalidCapacity", { reason: "duplicateMember" }));
  }
  const checked: MemberCapacity[] = [];
  for (const entry of entries) {
    if (!memberIds.includes(entry.memberId)) return err(domainError("NotASpaceMember"));
    if (entry.amount.currency.code !== currency) {
      return err(domainError("CurrencyMismatch", { expected: currency, actual: entry.amount.currency.code }));
    }
    if (entry.amount.minor < 0n) return err(domainError("InvalidCapacity", { reason: "negative" }));
    if (entry.amount.minor > 0n && viewerIds.includes(entry.memberId)) {
      return err(domainError("ViewerCannotHoldCapacity", { memberId: entry.memberId }));
    }
    checked.push({ memberId: entry.memberId, amount: entry.amount.minor });
  }
  return ok(checked);
};

/** HU-E6-02: a member without an explicit capacity counts as 0. */
export const capacityOf = (capacities: readonly MemberCapacity[], memberId: string): bigint =>
  capacities.find((c) => c.memberId === memberId)?.amount ?? 0n;

/** HU-E6-02: Σ capacities of the current members; a member who left keeps their row but no longer counts. */
export const totalCapacity = (capacities: readonly MemberCapacity[], memberIds: readonly string[]): bigint =>
  memberIds.reduce((sum, memberId) => sum + capacityOf(capacities, memberId), 0n);

/**
 * `part` in basis points of `total`, rounded half up (36.75 % = 3675); null when there is no total.
 * Precondition: 0 <= part <= total, so the result is within 0..10000; it does not clamp other values.
 */
export const shareOfTotal = (part: bigint, total: bigint): number | null =>
  total <= 0n ? null : Number((part * 20_000n + total) / (2n * total));
