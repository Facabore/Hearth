import type { LocalDate } from "@/shared/kernel";
import type { Recurrence, RecurrenceId } from "../domain/recurrence";

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
