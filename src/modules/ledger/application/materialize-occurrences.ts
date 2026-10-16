import { todayIn, type LocalDate, type Result } from "@/shared/kernel";
import type { Occurrence } from "../domain/occurrence";
import { materializeRecurrence, type MaterializeDeps, type RecurrenceRun } from "./materialize-recurrence";

/** A recurrence whose run failed, with what is safe to log about why. */
export interface MaterializationFailure {
  readonly recurrenceId: string;
  readonly spaceId: string;
  /** The error's name, or the code of the refusal. */
  readonly error: string;
  /** The SQLSTATE of the database error behind it, when there is one. */
  readonly code?: string;
  /** The constraint that database error names, when it names one. */
  readonly constraint?: string;
}

export interface MaterializationReport {
  readonly occurrences: readonly Occurrence[];
  readonly paused: readonly {
    readonly recurrenceId: string;
    readonly spaceId: string;
    readonly reason: string;
  }[];
  /** Recurrences whose run threw: their transaction rolled back and the next run retries them. */
  readonly failures: readonly MaterializationFailure[];
}

export type MaterializeDueOccurrences = (input: {
  readonly today?: LocalDate;
}) => Promise<MaterializationReport>;

/**
 * What is safe to say about a thrown error: its name and, when it carries a database error (Drizzle wraps the driver's
 * as the `cause`), its SQLSTATE and constraint. Never the message, the query or its parameters, which can carry
 * personal data. The job reports its own failures with it too (`logJobFailure`).
 */
export const failureOf = (error: unknown): Pick<MaterializationFailure, "error" | "code" | "constraint"> => {
  if (!(error instanceof Error)) return { error: "NonErrorThrown" };
  const { code, constraint } = (error.cause ?? error) as { code?: unknown; constraint?: unknown };
  return {
    error: error.name,
    ...(typeof code === "string" ? { code } : {}),
    ...(typeof constraint === "string" ? { constraint } : {}),
  };
};

/**
 * HU-E4-12 MaterializeDueOccurrences, the scheduler's job (ruling P20): every recurrence due today of every space, one
 * transaction each, so one that fails never stops the others. Idempotent: a second run on the same day finds
 * nothing due, and the unique key (recurrence, date) refuses a second occurrence of a date whatever happens.
 */
export const createMaterializeDueOccurrences =
  (deps: MaterializeDeps): MaterializeDueOccurrences =>
  async (input) => {
    const today = input.today ?? todayIn(deps.clock, deps.timeZone);
    const occurrences: Occurrence[] = [];
    const paused: { recurrenceId: string; spaceId: string; reason: string }[] = [];
    const failures: MaterializationFailure[] = [];
    for (const active of await deps.recurrences.listActive(today)) {
      const { id: recurrenceId, spaceId } = active;
      let run: Result<RecurrenceRun>;
      try {
        run = await materializeRecurrence(deps, active, today);
      } catch (error: unknown) {
        failures.push({ recurrenceId, spaceId, ...failureOf(error) });
        continue;
      }
      if (!run.ok) {
        failures.push({ recurrenceId, spaceId, error: run.error.code });
        continue;
      }
      occurrences.push(...run.value.occurrences);
      if (run.value.pausedFor !== null) paused.push({ recurrenceId, spaceId, reason: run.value.pausedFor });
    }
    return { occurrences, paused, failures };
  };
