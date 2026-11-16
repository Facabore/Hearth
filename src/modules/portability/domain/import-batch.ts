import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { SourceAccountType, SourceIssue, SourceSnapshot } from "./source-snapshot";

/** Design §3.2: an upload is a DRAFT until it is confirmed; a confirmed import can be undone once. */
export type ImportStatus = "DRAFT" | "CONFIRMED" | "UNDONE";

/** Where a source account's movements go: one of the person's accounts in the space, or a new one (design §2.1). */
export type AccountMapping =
  | { readonly kind: "existing"; readonly accountId: string }
  | { readonly kind: "new"; readonly type: SourceAccountType; readonly currency: string };

/**
 * Where a source category's movements go (design §2.2): an existing category, or a new one in `groupId`. A
 * subcategory's new category goes under whatever its parent maps to, so its `groupId` is null.
 */
export type CategoryMapping =
  | { readonly kind: "existing"; readonly categoryId: string }
  | { readonly kind: "new"; readonly groupId: string | null };

export interface ImportMappings {
  /** The zone the instants are read in (design §2.3); the person's own by default. */
  readonly timeZone: string;
  readonly accounts: Readonly<Record<string, AccountMapping>>;
  readonly categories: Readonly<Record<string, CategoryMapping>>;
  /** Source keys of likely duplicates the person chose to import anyway; every other duplicate is skipped. */
  readonly includeDuplicates: readonly string[];
}

/** What a confirm did (design §3.2), as the history shows it. */
export interface ImportCounts {
  readonly accountsCreated: number;
  readonly categoriesCreated: number;
  readonly movementsImported: number;
  /** Already linked by an earlier import that was not undone (design §3.3): never written twice. */
  readonly alreadyImported: number;
  readonly duplicatesSkipped: number;
  /** Gap G1: adjustments on or before their account's first movement, folded into its opening balance. */
  readonly adjustmentsInOpeningBalance: number;
  /** Gap G1, Q4: later adjustments wait for the ADJUSTMENT movement type; none is written. */
  readonly adjustmentsNotImported: number;
  readonly rowErrors: number;
}

/** The ids a confirm created, which its undo reverts (design §3.2). */
export interface CreatedEntities {
  readonly accounts: readonly string[];
  readonly categories: readonly string[];
  readonly movements: readonly string[];
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

export const NOTHING_CREATED: CreatedEntities = { accounts: [], categories: [], movements: [] };

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
