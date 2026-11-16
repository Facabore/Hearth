import type { LocalDate } from "@/shared/kernel";
import type { ImportMappings } from "./import-batch";
import type { SourceMovement, SourceSnapshot } from "./source-snapshot";

/**
 * The source key under which an adjustment folded into an opening balance is linked (gap G1): it names the source
 * row, and its own prefix keeps it apart from an account's key under the ACCOUNT entity type.
 */
export const openingKeyOf = (sourceKey: string): string => `opening:${sourceKey}`;

export interface ImportPlan {
  /** In date order, then source order: what the confirm records through the ledger. */
  readonly toRecord: readonly SourceMovement[];
  /** Gap G1: each new account's opening balance, the sum of its folded adjustments, in minor units of its currency. */
  readonly openingBalances: ReadonlyMap<string, bigint>;
  /** The adjustments folded into those opening balances. */
  readonly folded: readonly SourceMovement[];
  readonly alreadyImported: readonly string[];
  readonly duplicatesSkipped: readonly string[];
  /** Gap G1, Q4: adjustments after their account's first movement, which wait for the ADJUSTMENT type. */
  readonly adjustmentsNotImported: readonly string[];
}

/** Each account's earliest date among the movements that are not adjustments, as source or destination. */
const firstMovementDates = (movements: readonly SourceMovement[]): Map<string, LocalDate> => {
  const first = new Map<string, LocalDate>();
  const see = (accountId: string | null, date: LocalDate) => {
    if (accountId === null) return;
    const current = first.get(accountId);
    if (current === undefined || date < current) first.set(accountId, date);
  };
  for (const movement of movements) {
    if (movement.kind === "ADJUSTMENT") continue;
    see(movement.accountSourceId, movement.date);
    see(movement.toAccountSourceId, movement.date);
  }
  return first;
};

/**
 * What a confirm writes (design §3.2, §3.3, gap G1), decided before anything is written. Pure.
 *
 * - A movement an earlier import linked is skipped as already imported, edited or deleted in Hearth since or not.
 * - A likely duplicate is skipped unless the person included it.
 * - An adjustment dated on or before its account's first other movement, on an account the import creates, becomes
 *   part of that account's opening balance; any other adjustment is left for the ADJUSTMENT type (Q4) and counted.
 */
export const planImport = (
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
  known: { readonly linkedKeys: ReadonlySet<string>; readonly duplicateKeys: ReadonlySet<string> },
): ImportPlan => {
  const first = firstMovementDates(snapshot.movements);
  const included = new Set(mappings.includeDuplicates);
  const toRecord: SourceMovement[] = [];
  const folded: SourceMovement[] = [];
  const openingBalances = new Map<string, bigint>();
  const alreadyImported: string[] = [];
  const duplicatesSkipped: string[] = [];
  const adjustmentsNotImported: string[] = [];

  for (const movement of snapshot.movements) {
    if (movement.kind === "ADJUSTMENT") {
      const account = movement.accountSourceId;
      const firstDate = first.get(account);
      if (known.linkedKeys.has(openingKeyOf(movement.sourceKey))) {
        alreadyImported.push(movement.sourceKey);
      } else if (
        mappings.accounts[account]?.kind === "new" &&
        (firstDate === undefined || movement.date <= firstDate)
      ) {
        folded.push(movement);
        openingBalances.set(account, (openingBalances.get(account) ?? 0n) + movement.amount.minor);
      } else {
        adjustmentsNotImported.push(movement.sourceKey);
      }
      continue;
    }
    if (known.linkedKeys.has(movement.sourceKey)) alreadyImported.push(movement.sourceKey);
    else if (known.duplicateKeys.has(movement.sourceKey) && !included.has(movement.sourceKey)) {
      duplicatesSkipped.push(movement.sourceKey);
    } else toRecord.push(movement);
  }

  // A stable sort: the ledger sees the movements in the order they happened.
  toRecord.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { toRecord, openingBalances, folded, alreadyImported, duplicatesSkipped, adjustmentsNotImported };
};
