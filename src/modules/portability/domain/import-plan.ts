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
 *   part of that account's opening balance. One an undone import folded into the account it now maps to (restored
 *   with that opening balance) stays folded there, never recorded on top of it. Any other adjustment is recorded as an
 *   ADJUSTMENT movement (design Q4, #329), linked and checked for duplicates like every other movement.
 */
export const planImport = (
  snapshot: SourceSnapshot,
  mappings: ImportMappings,
  known: {
    readonly linkedKeys: ReadonlySet<string>;
    readonly duplicateKeys: ReadonlySet<string>;
    /** Design §3.3: each adjustment an undone import folded, by its opening key, and the account it went into. */
    readonly undoneOpenings: ReadonlyMap<string, string>;
  },
): ImportPlan => {
  const first = firstMovementDates(snapshot.movements);
  const included = new Set(mappings.includeDuplicates);
  const toRecord: SourceMovement[] = [];
  const folded: SourceMovement[] = [];
  const openingBalances = new Map<string, bigint>();
  const alreadyImported: string[] = [];
  const duplicatesSkipped: string[] = [];

  for (const movement of snapshot.movements) {
    if (movement.kind === "ADJUSTMENT") {
      const account = movement.accountSourceId;
      const mapping = mappings.accounts[account];
      const firstDate = first.get(account);
      const opening = openingKeyOf(movement.sourceKey);
      if (known.linkedKeys.has(opening)) {
        alreadyImported.push(movement.sourceKey);
        continue;
      }
      if (mapping?.kind === "new" && (firstDate === undefined || movement.date <= firstDate)) {
        folded.push(movement);
        openingBalances.set(account, (openingBalances.get(account) ?? 0n) + movement.amount.minor);
        continue;
      }
      if (mapping?.kind === "existing" && known.undoneOpenings.get(opening) === mapping.accountId) {
        folded.push(movement);
        continue;
      }
    }
    if (known.linkedKeys.has(movement.sourceKey)) alreadyImported.push(movement.sourceKey);
    else if (known.duplicateKeys.has(movement.sourceKey) && !included.has(movement.sourceKey)) {
      duplicatesSkipped.push(movement.sourceKey);
    } else toRecord.push(movement);
  }

  // A stable sort: the ledger sees the movements in the order they happened.
  toRecord.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { toRecord, openingBalances, folded, alreadyImported, duplicatesSkipped };
};
