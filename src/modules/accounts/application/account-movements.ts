import type { LocalDate } from "@/shared/kernel";

/**
 * Net ledger movements per account (HU-E2-04): incomes and transfers in, minus transfers out and
 * payments out; soft-deleted transactions excluded; `asOf` keeps transactions dated on or before it.
 * Bound to the ledger by the composition root.
 */
export interface AccountMovements {
  netMovements(accountIds: readonly string[], asOf: LocalDate | null): Promise<ReadonlyMap<string, bigint>>;
}
