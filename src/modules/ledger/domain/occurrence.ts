import { domainError, err, ok, type Id, type LocalDate, type Result } from "@/shared/kernel";
import type { Recurrence, RecurrenceId } from "./recurrence";
import { positiveAmount } from "./transaction";

export type OccurrenceId = Id<"Occurrence">;
export type OccurrenceStatus = "RECORDED" | "PENDING" | "SKIPPED";

/** One schedule date of a recurrence, stored once (unique per recurrence and date, spec 5.2) and never removed (D8). */
export interface Occurrence {
  readonly id: OccurrenceId;
  readonly recurrenceId: RecurrenceId;
  readonly spaceId: string;
  readonly date: LocalDate;
  readonly status: OccurrenceStatus;
  /** RECORDED: the amount recorded; PENDING: the suggested estimate; SKIPPED: what it would have recorded. */
  readonly amount: bigint;
  /** The transaction recorded for it; null unless RECORDED. */
  readonly transactionId: string | null;
  /** SKIPPED: PeriodClosed, PayerLeft, CreatorLeft or the refusing code (P25, P26); null when a member skipped it. */
  readonly reason: string | null;
  /** The user who confirmed or skipped it; null when the scheduler decided. */
  readonly resolvedBy: string | null;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

const occurrenceOf = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  now: Date,
  outcome: Pick<Occurrence, "status" | "transactionId" | "reason">,
): Occurrence => ({
  id,
  recurrenceId: recurrence.id,
  spaceId: recurrence.spaceId,
  date,
  amount: recurrence.amount,
  resolvedBy: null,
  createdAt: now,
  resolvedAt: null,
  ...outcome,
});

/** HU-E4-12: an AUTO occurrence recorded as `transactionId`. */
export const recordedOccurrence = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  transactionId: string,
  now: Date,
): Occurrence => occurrenceOf(id, recurrence, date, now, { status: "RECORDED", transactionId, reason: null });

/** HU-E4-13: a CONFIRM occurrence waiting for a member; it is not a transaction and never counts as spent. */
export const pendingOccurrence = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  now: Date,
): Occurrence =>
  occurrenceOf(id, recurrence, date, now, { status: "PENDING", transactionId: null, reason: null });

/** HU-E4-12, rulings P25 and P26: an occurrence the scheduler could not record, with the code that refused it. */
export const skippedOccurrence = (
  id: OccurrenceId,
  recurrence: Recurrence,
  date: LocalDate,
  reason: string,
  now: Date,
): Occurrence => occurrenceOf(id, recurrence, date, now, { status: "SKIPPED", transactionId: null, reason });

const pendingOnly = (occurrence: Occurrence): Result<Occurrence> =>
  occurrence.status === "PENDING"
    ? ok(occurrence)
    : err(domainError("OccurrenceNotPending", { status: occurrence.status }));

/**
 * HU-E4-13: a member confirmed a pending occurrence with the real amount, recorded as `transactionId`. Only a PENDING
 * occurrence is confirmed, and the real amount is positive like any recorded amount.
 */
export const confirmedOccurrence = (
  occurrence: Occurrence,
  confirmation: {
    readonly transactionId: string;
    readonly amount: bigint;
    readonly userId: string;
    readonly now: Date;
  },
): Result<Occurrence> => {
  const pending = pendingOnly(occurrence);
  if (!pending.ok) return pending;
  const amount = positiveAmount(confirmation.amount);
  if (!amount.ok) return amount;
  return ok({
    ...pending.value,
    status: "RECORDED",
    amount: amount.value,
    transactionId: confirmation.transactionId,
    resolvedBy: confirmation.userId,
    resolvedAt: confirmation.now,
  });
};

/** HU-E4-13: a member skipped a pending occurrence; nothing is recorded and the recurrence goes on. */
export const skippedByMember = (occurrence: Occurrence, userId: string, now: Date): Result<Occurrence> => {
  const pending = pendingOnly(occurrence);
  if (!pending.ok) return pending;
  return ok({ ...pending.value, status: "SKIPPED", reason: null, resolvedBy: userId, resolvedAt: now });
};
