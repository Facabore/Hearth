import {
  domainError,
  err,
  instantAt,
  localDate,
  localDateIn,
  ok,
  wallTimeIn,
  type LocalDate,
  type Result,
} from "@/shared/kernel";

/** HU-E4-14, D19: the local date a transaction counts in, and when it happened when it has a time. */
export interface TransactionTime {
  readonly date: LocalDate;
  /** The UTC instant; null only for occurrences and rows older than M3-D (ruling P66). */
  readonly occurredAt: Date | null;
  /** The recorder's IANA zone; set exactly when `occurredAt` is. */
  readonly timeZone: string | null;
}

/** What an edit asks for (HU-E4-06): `occurredAt: null` is TimeRequired, since a time is replaced, never removed. */
export interface TimeChange {
  readonly date?: LocalDate;
  readonly occurredAt?: Date | null;
  readonly timeZone?: string;
}

const mismatch = (date: LocalDate, local: LocalDate) =>
  err(domainError("DateTimeMismatch", { date, localDate: local }));

/**
 * HU-E4-14: the local date an instant counts in, which must be one a `date` can say (the kernel's `localDate`): an
 * instant that falls in a year before 1900 or past 9999 in its zone answers InvalidDate, with the instant as the value.
 */
const dateOf = (instant: Date, timeZone: string): Result<LocalDate> => {
  const date = localDate(localDateIn(instant, timeZone));
  return date.ok ? date : err(domainError("InvalidDate", { value: instant.toISOString() }));
};

/** HU-E4-14, ruling P66: every transaction a person records or edits has a time. */
const timeRequired = () => err(domainError("TimeRequired"));

/**
 * HU-E4-14, ruling P66: a new transaction's time. With neither a date nor an instant, `now` in `timeZone`; a date
 * alone takes `now`'s time of day on that date there (ruling P42 for a skipped or repeated time).
 */
export const timeOf = (input: {
  readonly date?: LocalDate;
  readonly occurredAt?: Date | null;
  readonly timeZone: string;
  readonly now: Date;
}): Result<TransactionTime> => {
  if (input.occurredAt === null) return timeRequired();
  if (input.occurredAt === undefined && input.date !== undefined) {
    const today = localDateIn(input.now, input.timeZone);
    const occurredAt =
      input.date === today
        ? input.now
        : instantAt(input.date, wallTimeIn(input.now, input.timeZone), input.timeZone);
    return ok({ date: input.date, occurredAt, timeZone: input.timeZone });
  }
  const occurredAt = input.occurredAt ?? input.now;
  const date = dateOf(occurredAt, input.timeZone);
  if (!date.ok) return date;
  if (input.date !== undefined && input.date !== date.value) return mismatch(input.date, date.value);
  return ok({ date: date.value, occurredAt, timeZone: input.timeZone });
};

/**
 * HU-E4-06, HU-E4-14, rulings P41, P42 and P66: an edited time. `fallbackZone` (the editor's) is used only when a
 * new instant is sent and neither the change nor the transaction names a zone. A `timeZone` without an instant
 * changes nothing (ruling P44). A time is replaced, never removed; a row without one keeps none until it gets one.
 * The answer holds the three time fields only, even when `current` is a whole transaction.
 */
export const retimed = (
  current: TransactionTime,
  change: TimeChange,
  fallbackZone: string,
): Result<TransactionTime> => {
  if (change.occurredAt === null) return timeRequired();
  if (change.occurredAt !== undefined) {
    const timeZone = change.timeZone ?? current.timeZone ?? fallbackZone;
    const date = dateOf(change.occurredAt, timeZone);
    if (!date.ok) return date;
    if (change.date !== undefined && change.date !== date.value) return mismatch(change.date, date.value);
    return ok({ date: date.value, occurredAt: change.occurredAt, timeZone });
  }
  // The stored date again is no move: re-timing it would read the second 02:30 of a repeated hour as the first (issue 119).
  if (change.date === undefined || change.date === current.date) {
    return ok({ date: current.date, occurredAt: current.occurredAt, timeZone: current.timeZone });
  }
  if (current.occurredAt === null || current.timeZone === null) {
    return ok({ date: change.date, occurredAt: null, timeZone: null });
  }
  const wall = wallTimeIn(current.occurredAt, current.timeZone);
  return ok({
    date: change.date,
    occurredAt: instantAt(change.date, wall, current.timeZone),
    timeZone: current.timeZone,
  });
};
