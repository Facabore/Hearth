import type { LocalDate } from "@/shared/kernel";
import { accountsMovedBy, datesThrough, type Recurrence, type RecurrenceType } from "../domain/recurrence";
import type { RecurrenceDeps } from "./recurrence-ports";

/** Ruling P238 (M6c): one movement a recurrence is going to record, as the cash-flow calendar reads it. */
export interface ScheduledMovement {
  readonly recurrenceId: string;
  /** The PENDING occurrence; null for a schedule date the scheduler has not reached. */
  readonly occurrenceId: string | null;
  readonly type: RecurrenceType;
  readonly description: string;
  /** A schedule date, or the date a PENDING occurrence was due. */
  readonly date: LocalDate;
  readonly status: "SCHEDULED" | "PENDING";
  /** CONFIRM recurrences: the amount is the estimate a member confirms or changes (HU-E4-13). */
  readonly estimated: boolean;
  /** Minor units of `currency`, positive. */
  readonly amount: bigint;
  readonly currency: string;
  readonly debitAccountId: string | null;
  readonly creditAccountId: string | null;
}

export type ListScheduledMovements = (input: {
  readonly spaceId: string;
  readonly through: LocalDate;
}) => Promise<ScheduledMovement[]>;

const movementOf = (
  recurrence: Recurrence,
  at: Pick<ScheduledMovement, "occurrenceId" | "date" | "status" | "amount">,
): ScheduledMovement => ({
  recurrenceId: recurrence.id,
  type: recurrence.template.type,
  description: recurrence.description,
  estimated: recurrence.mode === "CONFIRM",
  currency: recurrence.currency,
  ...accountsMovedBy(recurrence.template),
  ...at,
});

/**
 * Ruling P238 (M6c): a space's PENDING occurrences (earliest first, as the repository lists them, whatever the
 * state of their recurrence, HU-E4-13), then every schedule date through `through` of its ACTIVE recurrences, by
 * date and then in the order they were defined. A pending occurrence is never listed again as a schedule date: its
 * recurrence's `dueFrom` is already past it. The caller authorizes: this is a port, not an endpoint.
 */
export const createListScheduledMovements =
  (deps: Pick<RecurrenceDeps, "recurrences" | "occurrences">): ListScheduledMovements =>
  async ({ spaceId, through }) => {
    const recurrences = await deps.recurrences.list(spaceId);
    const byId = new Map(recurrences.map((r) => [r.id as string, r]));
    const pending = (await deps.occurrences.pendingOccurrences(spaceId)).flatMap((occurrence) => {
      const recurrence = byId.get(occurrence.recurrenceId);
      return recurrence === undefined
        ? []
        : [
            movementOf(recurrence, {
              occurrenceId: occurrence.id,
              date: occurrence.date,
              status: "PENDING",
              amount: occurrence.amount,
            }),
          ];
    });
    const scheduled = recurrences
      .flatMap((recurrence) =>
        datesThrough(recurrence, through).map((date) =>
          movementOf(recurrence, {
            occurrenceId: null,
            date,
            status: "SCHEDULED",
            amount: recurrence.amount,
          }),
        ),
      )
      // Stable: equal dates keep the recurrences' definition order.
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return [...pending, ...scheduled];
  };
