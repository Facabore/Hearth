import { addDays, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import {
  pendingOccurrence,
  recordedOccurrence,
  skippedOccurrence,
  type Occurrence,
} from "../domain/occurrence";
import { statusOf, type Recurrence } from "../domain/recurrence";
import { scheduleDates } from "../domain/recurrence-schedule";
import { openPeriod } from "./checks";
import { recordOccurrence, type OccurrenceRecorders } from "./record-occurrence";
import type { ActiveRecurrence, RecurrenceDeps } from "./recurrence-ports";

/** Schedule dates one run considers per recurrence at most; a longer backlog goes on in the next run. */
export const CATCH_UP_LIMIT = 24;

export interface MaterializeDeps extends RecurrenceDeps {
  /** The ledger's record use cases (ruling P21). */
  readonly recorders: OccurrenceRecorders;
}

/** What one run did to one recurrence. */
export interface RecurrenceRun {
  readonly occurrences: readonly Occurrence[];
  /** The reason this run paused it (ruling P26); null when it did not. */
  readonly pausedFor: string | null;
}

/** A stored amount the kernel refuses: the data is broken, which is no refusal of a date, so the run fails and is retried. */
class InvalidStoredAmount extends Error {
  override readonly name = "InvalidStoredAmount";
}

/**
 * One date of a recurrence (HU-E4-12, HU-E4-13): AUTO records it through the ledger's own use case on behalf of its
 * creator (ruling P21), CONFIRM leaves it pending unless its period is CLOSED (ruling P25); a refused date is
 * SKIPPED with the refusing code.
 *
 * The ledger refuses before it writes anything, so a refusal leaves no transaction behind and there is nothing to roll
 * back: the SKIPPED occurrence is written and the run goes on. Anything the ledger throws is not a refusal and rolls the
 * whole run back (see `materializeRecurrence`), and so does an amount that cannot be recorded at all.
 */
const occurrenceOn = async (
  deps: MaterializeDeps,
  recurrence: Recurrence,
  date: LocalDate,
  now: Date,
): Promise<Occurrence> => {
  const id = deps.ids.next<"Occurrence">();
  if (recurrence.mode === "CONFIRM") {
    const open = await openPeriod(deps, recurrence.spaceId, date);
    return open.ok
      ? pendingOccurrence(id, recurrence, date, now)
      : skippedOccurrence(id, recurrence, date, open.error.code, now);
  }
  const amount = Money.ofMinor(recurrence.amount, recurrence.currency);
  if (!amount.ok) throw new InvalidStoredAmount(amount.error.code);
  const recorded = await recordOccurrence(deps.recorders, recurrence, {
    userId: recurrence.createdBy,
    date,
    amount: amount.value,
  });
  return recorded.ok
    ? recordedOccurrence(id, recurrence, date, recorded.value.transaction.id, now)
    : skippedOccurrence(id, recurrence, date, recorded.error.code, now);
};

const nothingDue = (): Result<RecurrenceRun> => ok({ occurrences: [], pausedFor: null });

/**
 * The cursor from `next` on: once no schedule date is left from there through the end date, past the end date, so the
 * scheduler stops listing a recurrence that has nothing more to record instead of locking it on every run. It skips
 * no date.
 */
const cursorFrom = (recurrence: Pick<Recurrence, "schedule" | "endDate">, next: LocalDate): LocalDate =>
  recurrence.endDate !== null &&
  scheduleDates(recurrence.schedule, { from: next, through: recurrence.endDate }, 1).length === 0
    ? addDays(recurrence.endDate, 1)
    : next;

/**
 * HU-E4-12: every date from the first not considered yet through `today` (and its end date) becomes one occurrence
 * (spec 5.2), in one transaction under the recurrence's row lock, read under that lock (ruling P20): runs and writes
 * of one recurrence take turns, so a date is considered once and an edit or pause committed first is what counts.
 *
 * What `recordOccurrence` asks of its caller holds here: the transactions are recorded in the same `tm.run` as the
 * occurrence rows and the cursor, under the lock of the recurrence, as its creator, for dates not considered yet.
 * An unexpected failure, such as the unique key refusing a second occurrence of a date, rolls everything of this
 * recurrence back, its recorded transactions included, and the next run retries it.
 *
 * Ruling P24 (Task 2b): `dueFrom` only moves forward, and a resume moves it to the resume day. A date that fell due
 * before a pause and that no run had considered yet is therefore dropped when the recurrence resumes, never recorded
 * late. A recurrence with no schedule date left from `dueFrom` through its end date counts as finished (ENDED):
 * nothing is due, and that is no failure. Its `dueFrom` goes past the end date, as soon as a run records its last date
 * or finds that an edit left it none, so that `listActive` stops listing it and no run locks it again.
 */
export const materializeRecurrence = (
  deps: MaterializeDeps,
  active: ActiveRecurrence,
  today: LocalDate,
): Promise<Result<RecurrenceRun>> =>
  deps.tm.run(async () => {
    const recurrence = await deps.recurrences.lockForWrite(active.spaceId, active.id);
    if (recurrence === null) return nothingDue();
    const now = deps.clock.now();
    if (statusOf(recurrence) !== "ACTIVE") {
      // Paused or ended while this run waited for the lock, or out of dates: nothing is due. A recurrence an edit left
      // with no date is moved past its end date, like one whose last date a run recorded.
      const dueFrom = cursorFrom(recurrence, recurrence.dueFrom);
      if (dueFrom !== recurrence.dueFrom)
        await deps.recurrences.save({ ...recurrence, dueFrom, updatedAt: now });
      return nothingDue();
    }
    const through = recurrence.endDate !== null && recurrence.endDate < today ? recurrence.endDate : today;
    const dates = scheduleDates(recurrence.schedule, { from: recurrence.dueFrom, through }, CATCH_UP_LIMIT);
    if (dates.length === 0) return nothingDue();
    const occurrences: Occurrence[] = [];
    for (const date of dates) {
      const occurrence = await occurrenceOn(deps, recurrence, date, now);
      await deps.occurrences.addOccurrence(occurrence);
      occurrences.push(occurrence);
    }
    const dueFrom = cursorFrom(recurrence, addDays(dates.at(-1)!, 1));
    await deps.recurrences.save({ ...recurrence, dueFrom, updatedAt: now });
    return ok({ occurrences, pausedFor: null });
  });
