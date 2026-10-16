import type { LocalDate } from "@/shared/kernel";
import type { Occurrence } from "../domain/occurrence";
import { statusOf, upcomingDates, type Recurrence, type RecurrenceStatus } from "../domain/recurrence";
import type { OccurrenceRepository } from "./recurrence-ports";

/** A recurrence as members read it: its status, its next date and its latest occurrence (ruling P31). */
export interface RecurrenceView {
  readonly recurrence: Recurrence;
  readonly status: RecurrenceStatus;
  /** The next date it will record; null while paused or once ended. */
  readonly nextOccurrence: LocalDate | null;
  /** The latest date it considered: the transaction recorded for it, or why it was skipped. */
  readonly lastOccurrence: Occurrence | null;
}

export const recurrenceView = (
  recurrence: Recurrence,
  lastOccurrence: Occurrence | null,
): RecurrenceView => ({
  recurrence,
  status: statusOf(recurrence),
  nextOccurrence: upcomingDates(recurrence, 1)[0] ?? null,
  lastOccurrence,
});

/** The views of recurrences of one space, each with its latest occurrence, from one read. */
export const viewsOf = async (
  occurrences: Pick<OccurrenceRepository, "latestOccurrences">,
  spaceId: string,
  recurrences: readonly Recurrence[],
): Promise<RecurrenceView[]> => {
  const latest = await occurrences.latestOccurrences(
    spaceId,
    recurrences.map((r) => r.id),
  );
  return recurrences.map((r) => recurrenceView(r, latest.get(r.id) ?? null));
};
