import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { SourceAccountType, SourceIssue, SourceSnapshot } from "./source-snapshot";

/** Design §3.2: an upload is a DRAFT until it is confirmed; a confirmed import can be undone once. */
export type ImportStatus = "DRAFT" | "CONFIRMED" | "UNDONE";

/**
 * What a source account is (P337) and where its movements go (design §2.1):
 *
 * - **Cuenta**: one of the person's accounts in the space (`existing`), or a new one (`new`). An existing account may be
 *   an archived one only when an undone import of this source created it: the confirm restores it. A new account's
 *   `name` is one no account of the space holds, archived ones included (`checkMappings` settles it).
 * - **Archivar** (`archive`): its movements go to `accountId` and it leaves the pickers and totals. `accountId` is
 *   either an account of the person's this one duplicates (a starter "Efectivo" for "Cash"), never archived itself, or
 *   an archived account an earlier import of this source created, restored for its movements and archived again; null
 *   creates a new account, under a settled `name`, records its movements and archives it (history kept).
 * - **Persona** (`person`): someone who owes the person or whom they owe. A guest named `name` in the pair's direct
 *   space (P338), whose movements are recorded there as P334's settlements, never as an account.
 */
export type AccountMapping =
  | { readonly kind: "existing"; readonly accountId: string }
  | {
      readonly kind: "new";
      readonly type: SourceAccountType;
      readonly currency: string;
      readonly name?: string;
    }
  | {
      readonly kind: "archive";
      readonly accountId: string | null;
      readonly type: SourceAccountType;
      readonly currency: string;
      readonly name?: string;
    }
  | { readonly kind: "person"; readonly name?: string };

/** P337: whether the confirm creates an account for this mapping (a new one, or a new one it then archives). */
export const createsAccount = (mapping: AccountMapping): boolean =>
  mapping.kind === "new" || (mapping.kind === "archive" && mapping.accountId === null);

/** P337: the person's account the movements go to, for a mapping that uses one rather than creating it. */
export const targetAccountOf = (mapping: AccountMapping): string | null =>
  mapping.kind === "existing" || mapping.kind === "archive" ? mapping.accountId : null;

export interface ImportMappings {
  /** The zone the instants are read in (design §2.3); the person's own by default. */
  readonly timeZone: string;
  readonly accounts: Readonly<Record<string, AccountMapping>>;
  /**
   * P337: categories come as the person had them (`planCategoryGroups`), never remapped one by one; this says whether
   * the confirm also archives the seeded groups and categories no movement uses ("Archivar las de Hearth que no
   * uses"), on by default.
   */
  readonly archiveUnusedCategories: boolean;
  /** Source keys of likely duplicates the person chose to import anyway; every other duplicate is skipped. */
  readonly includeDuplicates: readonly string[];
}

/** What a confirm did (design §3.2), as the history shows it. */
export interface ImportCounts {
  readonly accountsCreated: number;
  /** Accounts an earlier, undone import of this source created, restored instead of created again (design §3.3). */
  readonly accountsRestored: number;
  readonly categoriesCreated: number;
  readonly categoriesRestored: number;
  readonly movementsImported: number;
  /** Already linked by an earlier import that was not undone (design §3.3): never written twice. */
  readonly alreadyImported: number;
  readonly duplicatesSkipped: number;
  /** Gap G1: adjustments on or before their account's first movement, folded into its opening balance. */
  readonly adjustmentsInOpeningBalance: number;
  /** Gap G1, Q4: later adjustments wait for the ADJUSTMENT movement type; none is written. */
  readonly adjustmentsNotImported: number;
  readonly rowErrors: number;
  /** P337: guests (Persona) this confirm added, each in a new direct space; 0 in a batch confirmed before P337. */
  readonly peopleCreated: number;
  /** P337: accounts it created or restored for Archivar and archived at its end; 0 before P337. */
  readonly accountsArchived: number;
  /** P337: seeded groups and categories no movement used, archived by "Archivar las de Hearth que no uses". */
  readonly hearthCategoriesArchived: number;
}

/** The ids a confirm created, which its undo reverts (design §3.2). */
export interface CreatedEntities {
  readonly accounts: readonly string[];
  readonly categories: readonly string[];
  readonly movements: readonly string[];
  /** P337: the settlements it recorded for a Persona, each in its direct space (not the batch's own space). */
  readonly settlements: readonly { readonly spaceId: string; readonly movementId: string }[];
  /** P337: the direct spaces it opened for a Persona; an undo leaves them and their guests (no hard deletes). */
  readonly people: readonly string[];
  /** P337: the category groups it created or restored, in that order. */
  readonly groups: readonly string[];
  /** P337: the seeded groups and categories (subcategories after their parent) it archived; an undo restores them. */
  readonly archivedSeeded: { readonly groups: readonly string[]; readonly categories: readonly string[] };
}

export interface ImportBatch {
  readonly id: string;
  readonly spaceId: string;
  readonly userId: string;
  readonly sourceApp: string;
  /** SHA-256 of the uploaded bytes, hex; the file itself is never stored (design §3.5). */
  readonly fileSha256: string;
  readonly status: ImportStatus;
  /** Null once removed: 7 days after the batch is confirmed or undone, or abandoned as a draft (design §3.5). */
  readonly snapshot: SourceSnapshot | null;
  readonly mappings: ImportMappings;
  readonly counts: ImportCounts | null;
  /** Rows the confirm could not record, by source key, with the ledger's code (design §3.2). */
  readonly rowErrors: readonly SourceIssue[];
  readonly created: CreatedEntities;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly undoneAt: Date | null;
}

/** Design §3.5: the snapshot is technical data, kept this long after the batch is settled or abandoned. */
export const SNAPSHOT_RETENTION_DAYS = 7;

export const NOTHING_CREATED: CreatedEntities = {
  accounts: [],
  categories: [],
  movements: [],
  settlements: [],
  people: [],
  groups: [],
  archivedSeeded: { groups: [], categories: [] },
};

/** A batch that still takes mapping changes and a confirm: a draft whose snapshot is still kept. */
export const draftSnapshot = (batch: ImportBatch): Result<SourceSnapshot> => {
  if (batch.status !== "DRAFT") return err(domainError("ImportNotDraft", { status: batch.status }));
  return batch.snapshot === null ? err(domainError("ImportSnapshotExpired")) : ok(batch.snapshot);
};

/** DRAFT → CONFIRMED, with what the confirm did. */
export const confirmBatch = (
  batch: ImportBatch,
  outcome: { counts: ImportCounts; rowErrors: readonly SourceIssue[]; created: CreatedEntities },
  now: Date,
): Result<ImportBatch> => {
  const draft = draftSnapshot(batch);
  if (!draft.ok) return draft;
  return ok({ ...batch, ...outcome, status: "CONFIRMED", confirmedAt: now });
};

/** CONFIRMED → UNDONE; a draft or an undone batch has nothing to undo. */
export const undoBatch = (batch: ImportBatch, now: Date): Result<ImportBatch> =>
  batch.status === "CONFIRMED"
    ? ok({ ...batch, status: "UNDONE", undoneAt: now })
    : err(domainError("ImportNotConfirmed", { status: batch.status }));
