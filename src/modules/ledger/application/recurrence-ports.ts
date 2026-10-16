import type { LocalDate } from "@/shared/kernel";
import type { Occurrence } from "../domain/occurrence";
import type { Recurrence, RecurrenceId } from "../domain/recurrence";
import type { LedgerDeps } from "./deps";

/** A recurrence the scheduler still drives (ruling P20). */
export interface ActiveRecurrence {
  readonly id: RecurrenceId;
  readonly spaceId: string;
}

export interface RecurrenceRepository {
  add(recurrence: Recurrence): Promise<void>;
  /** A recurrence of the space; null for unknown or malformed ids. */
  find(spaceId: string, recurrenceId: string): Promise<Recurrence | null>;
  /** The space's recurrences in the order they were defined. */
  list(spaceId: string): Promise<Recurrence[]>;
  /**
   * Locks the recurrence until the surrounding transaction ends and reads it under that lock (preflight N4), so the
   * writes and scheduler runs of one recurrence take turns on committed data; null for unknown or malformed ids.
   */
  lockForWrite(spaceId: string, recurrenceId: string): Promise<Recurrence | null>;
  /**
   * Writes what a recurrence may change after it was defined (ruling P22): its amount, schedule, dates and status, and
   * an expense's category and split or an income's category. Its type, payer and accounts stay as defined. Nothing is
   * ever deleted (D8), and callers read the row under `lockForWrite` first, so a recurrence that no stored one matches
   * by id, space and type is a programming error: this throws an Error, and the transaction rolls back.
   */
  save(recurrence: Recurrence): Promise<void>;
  /**
   * Every space's recurrences due on or before `today` that are neither paused nor ended and whose `dueFrom` is on or
   * before their end date, in the order they were defined. This is looser than the domain's `statusOf`: a recurrence
   * whose end date is not a schedule date stays listed after its last date, until the run that reads it under the lock
   * finds nothing left to record and marks it finished.
   */
  listActive(today: LocalDate): Promise<ActiveRecurrence[]>;
}

/** HU-E4-12, HU-E4-13: occurrences, one per recurrence and date (recurrence_occurrences_date_uq, spec 5.2). */
export interface OccurrenceRepository {
  /** Inserts it; fails when its recurrence already has an occurrence on that date, so its transaction rolls back. */
  addOccurrence(occurrence: Occurrence): Promise<void>;
  /**
   * Writes what resolving an occurrence changes: its status, amount, transaction, reason and resolution. Its recurrence,
   * date and creation stay as stored. Nothing is ever deleted (D8), and callers read the row under the lock of
   * `findOccurrence` first, so an occurrence that no stored one matches by id and space is a programming error: this
   * throws an Error, and the transaction rolls back.
   */
  saveOccurrence(occurrence: Occurrence): Promise<void>;
  /**
   * An occurrence of the space; with `lock`, locked until the transaction ends and read under that lock, so a confirm
   * and a skip of one occurrence take turns. Null for unknown or malformed ids.
   */
  findOccurrence(
    spaceId: string,
    occurrenceId: string,
    options?: { readonly lock?: boolean },
  ): Promise<Occurrence | null>;
  /** The space's PENDING occurrences, earliest date first, ties by id; [] for unknown or malformed ids. */
  pendingOccurrences(spaceId: string): Promise<Occurrence[]>;
  /**
   * The latest occurrence (by date, whatever its status) of each of these recurrences of the space. A recurrence with
   * none, one of another space and a malformed id are absent from the map.
   */
  latestOccurrences(
    spaceId: string,
    recurrenceIds: readonly string[],
  ): Promise<ReadonlyMap<string, Occurrence>>;
}

/** HU-E4-11 … HU-E4-13: the ledger, plus its recurrences and their occurrences. */
export interface RecurrenceDeps extends LedgerDeps {
  readonly recurrences: RecurrenceRepository;
  readonly occurrences: OccurrenceRepository;
}
