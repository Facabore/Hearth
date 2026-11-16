import type { SpaceAccess, SpaceLocks } from "@/modules/spaces/application";
import type {
  Clock,
  IdGenerator,
  LocalDate,
  Money,
  Result,
  TransactionManager,
  UserTimeZones,
} from "@/shared/kernel";
import type { ImportBatch } from "../domain/import-batch";
import type { HearthTargets } from "../domain/mapping-proposals";
import type { SourceAccountType, SourceMovementKind, SourceSnapshot } from "../domain/source-snapshot";

/** Reads an upload into a snapshot, off the server's own thread and with a time limit (design §3.5). */
export interface SnapshotReader {
  read(bytes: Uint8Array): Promise<Result<SourceSnapshot>>;
}

export interface ImportBatchRepository {
  add(batch: ImportBatch): Promise<void>;
  find(spaceId: string, importId: string): Promise<ImportBatch | null>;
  /** The batch with its row locked until the transaction ends, so two confirms or undos of it take turns. */
  findForUpdate(spaceId: string, importId: string): Promise<ImportBatch | null>;
  save(batch: ImportBatch): Promise<void>;
  /** Every batch of the space, newest first, without its snapshot (the history needs none). */
  listBySpace(spaceId: string): Promise<ImportBatch[]>;
  /** When a confirmed, not undone batch of the space last imported a file with this hash; null when none did. */
  lastConfirmedWithHash(spaceId: string, fileSha256: string, exceptId: string): Promise<Date | null>;
  /**
   * Design §3.5: removes physically the snapshot of every batch confirmed or undone, or created and never
   * confirmed, before `before`; the batch row stays for the history. Answers how many snapshots it removed.
   */
  removeSnapshotsSettledBefore(before: Date): Promise<number>;
}

export type ImportEntityType = "ACCOUNT" | "CATEGORY" | "MOVEMENT";

export interface ImportLink {
  readonly spaceId: string;
  readonly sourceApp: string;
  readonly sourceKey: string;
  readonly entityType: ImportEntityType;
  readonly entityId: string;
  readonly importId: string;
}

export interface ImportLinkRepository {
  /** Design §3.3: the links of the space for one source app, those of undone batches left out. */
  linksOf(spaceId: string, sourceApp: string): Promise<ImportLink[]>;
  /** The links of undone batches only: what a re-import of the same source may restore (design §3.3). */
  undoneLinksOf(spaceId: string, sourceApp: string): Promise<ImportLink[]>;
  /** Writes the links; a key already linked (by an undone batch, or a re-mapped account) points at the new entity. */
  upsert(links: readonly ImportLink[]): Promise<void>;
}

/** A movement already in Hearth on one of the person's accounts, in that account's own currency (design §3.1). */
export interface HearthMovement {
  readonly accountId: string;
  readonly date: LocalDate;
  readonly amountMinor: bigint;
  readonly kind: SourceMovementKind;
  /** A transfer that reached this account, as opposed to one that left it. */
  readonly incoming?: true;
}

/** When a recorded movement happened (HU-E4-14): its instant and zone, or its date alone. */
export type MovementTime =
  | { readonly date: LocalDate; readonly occurredAt: Date; readonly timeZone: string }
  | { readonly date: LocalDate; readonly untimed: true };

export interface MovementBase {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly time: MovementTime;
}

/**
 * Design §3.1's `ImportWriter`: every write goes through the accounts, categories and ledger use cases, so an import
 * stores only what a person could record, under the same rules, locks and audit. Composition implements it.
 */
export interface ImportWriter {
  /** The person's own accounts in the space and the space's category tree, archived ones included. */
  targetsOf(spaceId: string, userId: string): Promise<Result<HearthTargets>>;
  /** The live movements of these accounts between the dates, for likely duplicates (design §3.1). */
  movementsOf(
    spaceId: string,
    accountIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<HearthMovement[]>;
  createAccount(input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly name: string;
    readonly type: SourceAccountType;
    readonly openingBalance: Money;
    readonly cutOffDay: number | null;
    readonly paymentDay: number | null;
  }): Promise<Result<string>>;
  createCategory(input: {
    readonly spaceId: string;
    readonly userId: string;
    readonly name: string;
    readonly groupId?: string;
    readonly parentCategoryId?: string;
    readonly emoji: string | null;
  }): Promise<Result<string>>;
  recordExpense(
    input: MovementBase & {
      readonly categoryId: string;
      readonly accountId: string;
      readonly amount: Money;
      readonly convertedAmount?: Money;
    },
  ): Promise<Result<string>>;
  recordIncome(
    input: MovementBase & {
      readonly categoryId: string;
      readonly accountId: string;
      readonly amount: Money;
      readonly convertedAmount?: Money;
    },
  ): Promise<Result<string>>;
  recordTransfer(
    input: MovementBase & {
      readonly sourceAccountId: string;
      readonly destinationAccountId: string;
      readonly amount: Money;
      readonly destinationAmount?: Money;
    },
  ): Promise<Result<string>>;
  /** Design Q4 (#329): a balance adjustment of one account; `amount` is signed, in the account's own currency. */
  recordAdjustment(
    input: MovementBase & {
      readonly accountId: string;
      readonly amount: Money;
    },
  ): Promise<Result<string>>;
  /**
   * D8: a logical delete through the ledger; a movement already deleted is left as it is. Answers whether this call
   * deleted it.
   */
  deleteMovement(input: { spaceId: string; userId: string; movementId: string }): Promise<Result<boolean>>;
  archiveAccount(input: { spaceId: string; userId: string; accountId: string }): Promise<Result<void>>;
  restoreAccount(input: { spaceId: string; userId: string; accountId: string }): Promise<Result<void>>;
  restoreCategory(input: { spaceId: string; userId: string; categoryId: string }): Promise<Result<void>>;
  createCategoryGroup(input: { spaceId: string; userId: string; name: string }): Promise<Result<string>>;
  archiveCategory(input: { spaceId: string; userId: string; categoryId: string }): Promise<Result<void>>;
  /** Whether a live movement still uses the account or the category (D8: deleted ones do not count). */
  accountInUse(spaceId: string, accountId: string): Promise<boolean>;
  categoryInUse(spaceId: string, categoryId: string): Promise<boolean>;
}

export interface ImportDeps {
  readonly access: SpaceAccess;
  /** Issue #89: confirm and undo hold the space row before they read membership or anything they decide on. */
  readonly spaceLocks: Pick<SpaceLocks, "lockForMoneyWrite">;
  readonly reader: SnapshotReader;
  readonly batches: ImportBatchRepository;
  readonly links: ImportLinkRepository;
  readonly writer: ImportWriter;
  /** SHA-256 of the uploaded bytes, as lowercase hex. */
  readonly digest: (bytes: Uint8Array) => string;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly userTimeZones: UserTimeZones;
  readonly tm: TransactionManager;
}
