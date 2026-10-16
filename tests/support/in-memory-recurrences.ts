import type {
  ActiveRecurrence,
  Occurrence,
  OccurrenceRepository,
  Recurrence,
  RecurrenceRepository,
  RecurrenceTemplate,
} from "@/modules/ledger/application";
import type { LocalDate } from "@/shared/kernel";

/** The template as it was defined, with the category and split an edit may change taken from `next` (ruling P22). */
const editedTemplate = (stored: RecurrenceTemplate, next: RecurrenceTemplate): RecurrenceTemplate =>
  stored.type === "EXPENSE" && next.type === "EXPENSE"
    ? { ...stored, categoryId: next.categoryId, split: next.split }
    : stored.type === "INCOME" && next.type === "INCOME"
      ? { ...stored, categoryId: next.categoryId }
      : stored;

/** The order the adapter answers in: when they were created, then by id. */
const definedFirst = (a: Recurrence, b: Recurrence) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The order the adapter lists occurrences in: earliest date first, then by id. */
const earliestFirst = (a: Occurrence, b: Occurrence) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Recurrences and occurrences over arrays; recurrences.int.test.ts runs the same sequences against PostgreSQL. */
export class InMemoryRecurrences implements RecurrenceRepository, OccurrenceRepository {
  rows: Recurrence[] = [];
  occurrenceRows: Occurrence[] = [];
  /** Ids read with lockForWrite, in order. */
  readonly locked: string[] = [];

  async add(recurrence: Recurrence) {
    this.rows.push(recurrence);
  }

  async find(spaceId: string, recurrenceId: string) {
    return this.rows.find((r) => r.id === recurrenceId && r.spaceId === spaceId) ?? null;
  }

  async list(spaceId: string) {
    return this.rows.filter((r) => r.spaceId === spaceId).sort(definedFirst);
  }

  async lockForWrite(spaceId: string, recurrenceId: string) {
    this.locked.push(recurrenceId);
    return this.find(spaceId, recurrenceId);
  }

  async save(recurrence: Recurrence) {
    const isStored = (stored: Recurrence) =>
      stored.id === recurrence.id &&
      stored.spaceId === recurrence.spaceId &&
      stored.template.type === recurrence.template.type;
    if (!this.rows.some(isStored)) {
      throw new Error(`recurrence ${recurrence.id} (${recurrence.template.type}) is not stored in its space`);
    }
    this.rows = this.rows.map((stored) =>
      isStored(stored)
        ? {
            ...stored,
            description: recurrence.description,
            amount: recurrence.amount,
            template: editedTemplate(stored.template, recurrence.template),
            schedule: recurrence.schedule,
            mode: recurrence.mode,
            endDate: recurrence.endDate,
            dueFrom: recurrence.dueFrom,
            pausedAt: recurrence.pausedAt,
            pauseReason: recurrence.pauseReason,
            endedAt: recurrence.endedAt,
            updatedAt: recurrence.updatedAt,
          }
        : stored,
    );
  }

  async listActive(today: LocalDate): Promise<ActiveRecurrence[]> {
    return [...this.rows]
      .sort(definedFirst)
      .filter(
        (r) =>
          r.pausedAt === null &&
          r.endedAt === null &&
          r.dueFrom <= today &&
          (r.endDate === null || r.dueFrom <= r.endDate),
      )
      .map((r) => ({ id: r.id, spaceId: r.spaceId }));
  }

  async addOccurrence(occurrence: Occurrence) {
    // recurrence_occurrences_date_uq
    if (
      this.occurrenceRows.some(
        (o) => o.recurrenceId === occurrence.recurrenceId && o.date === occurrence.date,
      )
    ) {
      throw new Error(`duplicate occurrence of ${occurrence.recurrenceId} on ${occurrence.date}`);
    }
    this.occurrenceRows.push(occurrence);
  }

  async saveOccurrence(occurrence: Occurrence) {
    const isStored = (stored: Occurrence) =>
      stored.id === occurrence.id && stored.spaceId === occurrence.spaceId;
    if (!this.occurrenceRows.some(isStored)) {
      throw new Error(`occurrence ${occurrence.id} is not stored in its space`);
    }
    // As the adapter: the recurrence, the date and the creation stay as stored.
    this.occurrenceRows = this.occurrenceRows.map((stored) =>
      isStored(stored)
        ? {
            ...stored,
            status: occurrence.status,
            amount: occurrence.amount,
            transactionId: occurrence.transactionId,
            reason: occurrence.reason,
            resolvedBy: occurrence.resolvedBy,
            resolvedAt: occurrence.resolvedAt,
          }
        : stored,
    );
  }

  async findOccurrence(spaceId: string, occurrenceId: string) {
    return this.occurrenceRows.find((o) => o.id === occurrenceId && o.spaceId === spaceId) ?? null;
  }

  async pendingOccurrences(spaceId: string) {
    return this.occurrenceRows
      .filter((o) => o.spaceId === spaceId && o.status === "PENDING")
      .sort(earliestFirst);
  }

  async latestOccurrences(spaceId: string, recurrenceIds: readonly string[]) {
    const latest = new Map<string, Occurrence>();
    for (const o of this.occurrenceRows) {
      if (o.spaceId !== spaceId || !recurrenceIds.includes(o.recurrenceId)) continue;
      const seen = latest.get(o.recurrenceId);
      if (seen === undefined || o.date > seen.date) latest.set(o.recurrenceId, o);
    }
    return latest;
  }
}
