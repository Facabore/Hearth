import { requirePermission, type SpaceMembership } from "@/modules/spaces/application";
import {
  domainError,
  err,
  ok,
  resolvePeriod,
  type LocalDate,
  type Money,
  type Result,
} from "@/shared/kernel";
import { confirmedOccurrence, skippedByMember, type Occurrence } from "../domain/occurrence";
import type { Recurrence } from "../domain/recurrence";
import { authorizeWriter } from "./checks";
import type { MaterializeDeps } from "./materialize-recurrence";
import { recordOccurrence, type RecordedOccurrence } from "./record-occurrence";
import type { RecurrenceDeps } from "./recurrence-ports";

/** A pending occurrence with the recurrence it belongs to (its description, type and category). */
export interface PendingOccurrenceView {
  readonly occurrence: Occurrence;
  readonly recurrence: Recurrence;
}

export type ListPendingOccurrences = (input: {
  spaceId: string;
  userId: string;
}) => Promise<Result<PendingOccurrenceView[]>>;

export interface ConfirmOccurrenceInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly occurrenceId: string;
  /** The real amount, in the space currency. */
  readonly amount: Money;
  /** HU-E4-13: another day of the occurrence's period; the occurrence's own date when absent. */
  readonly date?: LocalDate;
}

/** The confirmed occurrence and what recording it gave: the transaction and its warnings. */
export interface ConfirmedOccurrence extends RecordedOccurrence {
  readonly occurrence: Occurrence;
}

export type ConfirmOccurrence = (input: ConfirmOccurrenceInput) => Promise<Result<ConfirmedOccurrence>>;
export type SkipOccurrence = (input: {
  spaceId: string;
  userId: string;
  occurrenceId: string;
}) => Promise<Result<PendingOccurrenceView>>;

/**
 * HU-E4-13: pending occurrences are listed for members who record money (MEMBER or above), whatever the state of their
 * recurrence; an archived space still lists them (HU-E1-09). They are not transactions and never count as spent.
 */
export const createListPendingOccurrences =
  (deps: Pick<RecurrenceDeps, "access" | "recurrences" | "occurrences">): ListPendingOccurrences =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId, { readOnly: true });
    if (!membership.ok) return membership;
    const reader = requirePermission(membership.value, "money.record");
    if (!reader.ok) return reader;
    const spaceId = reader.value.spaceId;
    const recurrences = new Map((await deps.recurrences.list(spaceId)).map((r) => [r.id as string, r]));
    const pending = await deps.occurrences.pendingOccurrences(spaceId);
    return ok(
      pending.flatMap((occurrence) => {
        const recurrence = recurrences.get(occurrence.recurrenceId);
        return recurrence === undefined ? [] : [{ occurrence, recurrence }];
      }),
    );
  };

/**
 * A PENDING occurrence of the space, locked for this transaction and read under the lock, with its recurrence. A
 * recurrence that was paused or ended since keeps its pending occurrences confirmable: they were due before it stopped.
 */
const pendingForWrite = async (
  deps: Pick<RecurrenceDeps, "recurrences" | "occurrences">,
  space: SpaceMembership,
  occurrenceId: string,
): Promise<Result<PendingOccurrenceView>> => {
  const occurrence = await deps.occurrences.findOccurrence(space.spaceId, occurrenceId, { lock: true });
  const recurrence =
    occurrence === null ? null : await deps.recurrences.find(space.spaceId, occurrence.recurrenceId);
  if (occurrence === null || recurrence === null) return err(domainError("OccurrenceNotFound"));
  return occurrence.status === "PENDING"
    ? ok({ occurrence, recurrence })
    : err(domainError("OccurrenceNotPending", { status: occurrence.status }));
};

/**
 * HU-E4-13 ConfirmOccurrence: records the occurrence with the real amount, and optionally another day of its period,
 * through the use case a member would call, from the recurrence's current template (ruling P21). The confirming member
 * is the requester, so D9 holds: only the owner of the paying account confirms a debit from it, while anyone who
 * records money confirms a fund-paid or guest-paid one. A CLOSED period answers PeriodClosed (ruling P25), and an
 * archived space SpaceArchived (HU-E1-09).
 *
 * What `recordOccurrence` asks of its caller holds here: it records inside the same `tm.run` as the occurrence-row
 * write, under the occurrence's row lock and only for the occurrence read under that lock (only a PENDING one is
 * confirmed, so a confirm and a skip take turns), as the confirming member, and any refusal is returned from this
 * `tm.run`, which aborts it: the occurrence stays PENDING and no transaction exists.
 */
export const createConfirmOccurrence =
  (deps: MaterializeDeps): ConfirmOccurrence =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const pending = await pendingForWrite(deps, space, input.occurrenceId);
      if (!pending.ok) return pending;
      const { occurrence, recurrence } = pending.value;
      const date = input.date ?? occurrence.date;
      // D10: the occurrence's period as the space resolves it, with the periods its plans stored; its scheduled date,
      // not the day of confirming, tells which period that is.
      const period = resolvePeriod(
        space.periodPolicy,
        await deps.storedPeriods(space.spaceId),
        occurrence.date,
      );
      if (date < period.start || date > period.end) return err(domainError("InvalidOccurrenceDate"));
      const recorded = await recordOccurrence(deps.recorders, recurrence, {
        userId: input.userId,
        date,
        amount: input.amount,
      });
      if (!recorded.ok) return recorded;
      const confirmed = confirmedOccurrence(occurrence, {
        transactionId: recorded.value.transaction.id,
        amount: input.amount.minor,
        userId: input.userId,
        now: deps.clock.now(),
      });
      if (!confirmed.ok) return confirmed;
      await deps.occurrences.saveOccurrence(confirmed.value);
      return ok({ ...recorded.value, occurrence: confirmed.value });
    });

/**
 * HU-E4-13 SkipOccurrence: the occurrence is marked skipped, nothing is recorded, and the recurrence goes on (its next
 * date is already the following one). Like a confirmation, it decides on the PENDING occurrence read under its lock.
 */
export const createSkipOccurrence =
  (deps: RecurrenceDeps): SkipOccurrence =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const pending = await pendingForWrite(deps, writer.value, input.occurrenceId);
      if (!pending.ok) return pending;
      const skipped = skippedByMember(pending.value.occurrence, input.userId, deps.clock.now());
      if (!skipped.ok) return skipped;
      await deps.occurrences.saveOccurrence(skipped.value);
      return ok({ occurrence: skipped.value, recurrence: pending.value.recurrence });
    });
