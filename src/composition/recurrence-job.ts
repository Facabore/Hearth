import type { MaterializationReport, MaterializeDueOccurrences } from "@/modules/ledger/application";
import type { Logger } from "@/shared/http";
import { failureOf, type Scheduler } from "@/shared/kernel";

export interface RecurrenceJobDeps {
  readonly materialize: MaterializeDueOccurrences;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

type Failure = MaterializationReport["failures"][number];

/**
 * A failure's log fields: the recurrence, the error's name (or the refusal's code) and, for a database error, its
 * SQLSTATE and constraint. Named one by one, so that nothing else a failure may carry, such as a message, a query or
 * its parameters, which can hold personal data, ever reaches the logs.
 */
const failureFields = (failure: Failure) => ({
  recurrenceId: failure.recurrenceId,
  spaceId: failure.spaceId,
  error: failure.error,
  ...(failure.code === undefined ? {} : { code: failure.code }),
  ...(failure.constraint === undefined ? {} : { constraint: failure.constraint }),
});

/**
 * A run that failed as a whole, for example because the database was unreachable. Drizzle throws a plain `Error` that
 * holds the query, so the name alone says little: it also logs the SQLSTATE and constraint of the database error behind
 * it, extracted like a failed recurrence's (`failureOf`), and never a message, a query or its parameters.
 */
export const logJobFailure =
  (logger: Logger) =>
  (error: unknown): void => {
    const { error: name, ...database } = failureOf(error);
    logger.error("recurrence_job_failed", { name, ...database });
  };

/**
 * HU-E4-12 (ruling P20): the in-container job that records due occurrences; no endpoint triggers it. Every skipped
 * occurrence is logged with its reason (PeriodClosed, ruling P25), and so is every pause and every failed recurrence.
 * A run that throws is its scheduler's to report and to run again.
 */
export const startRecurrenceJob = (deps: RecurrenceJobDeps, intervalMs: number): (() => void) =>
  deps.scheduler.every(intervalMs, async () => {
    const report = await deps.materialize({});
    for (const occurrence of report.occurrences) {
      if (occurrence.status !== "SKIPPED") continue;
      deps.logger.info("recurrence_occurrence_skipped", {
        recurrenceId: occurrence.recurrenceId,
        spaceId: occurrence.spaceId,
        date: occurrence.date,
        reason: occurrence.reason,
      });
    }
    for (const paused of report.paused) {
      deps.logger.info("recurrence_paused", {
        recurrenceId: paused.recurrenceId,
        spaceId: paused.spaceId,
        reason: paused.reason,
      });
    }
    for (const failure of report.failures) {
      deps.logger.error("recurrence_materialization_failed", failureFields(failure));
    }
  });
