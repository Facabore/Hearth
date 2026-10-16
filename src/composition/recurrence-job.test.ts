import { describe, expect, it } from "vitest";
import type {
  MaterializationReport,
  Occurrence,
  OccurrenceId,
  OccurrenceStatus,
  RecurrenceId,
} from "@/modules/ledger/application";
import type { Logger } from "@/shared/http";
import type { LocalDate, Scheduler } from "@/shared/kernel";
import { logJobFailure, startRecurrenceJob } from "./recurrence-job";

const occurrence = (status: OccurrenceStatus, reason: string | null): Occurrence => ({
  id: "occ-1" as OccurrenceId,
  recurrenceId: "rec-1" as RecurrenceId,
  spaceId: "space-1",
  date: "2026-12-01" as LocalDate,
  status,
  amount: 100n,
  transactionId: status === "RECORDED" ? "tx-1" : null,
  reason,
  resolvedBy: null,
  createdAt: new Date("2026-12-01T05:00:00Z"),
  resolvedAt: null,
});

type Logged = [level: string, event: string, data: Record<string, unknown> | undefined];

/** Starts the job over a scheduler that only remembers its ticks; `materialize` answers `report`. */
const started = (report: MaterializationReport | Error) => {
  const ticks: { intervalMs: number; job: () => Promise<void> }[] = [];
  const scheduler: Scheduler = {
    every: (intervalMs, job) => {
      ticks.push({ intervalMs, job });
      return () => undefined;
    },
  };
  const logged: Logged[] = [];
  const logger: Logger = {
    info: (event, data) => logged.push(["info", event, data]),
    error: (event, data) => logged.push(["error", event, data]),
  };
  const asked: unknown[] = [];
  const stop = startRecurrenceJob(
    {
      materialize: async (input) => {
        asked.push(input);
        if (report instanceof Error) throw report;
        return report;
      },
      scheduler,
      logger,
    },
    300_000,
  );
  return { ticks, logged, asked, stop };
};

describe("the recurring-transactions job (HU-E4-12, P20)", () => {
  it("materializes on every tick of its scheduler and logs every skip, pause and failure", async () => {
    const report: MaterializationReport = {
      occurrences: [occurrence("SKIPPED", "PeriodClosed"), occurrence("RECORDED", null)],
      paused: [{ recurrenceId: "rec-2", spaceId: "space-1", reason: "PayerLeft" }],
      failures: [{ recurrenceId: "rec-3", spaceId: "space-2", error: "Error" }],
    };
    const { ticks, logged, asked } = started(report);
    expect(ticks.map((t) => t.intervalMs)).toEqual([300_000]);
    await ticks[0]!.job();
    expect(asked).toEqual([{}]);
    expect(logged).toStrictEqual([
      [
        "info",
        "recurrence_occurrence_skipped",
        { recurrenceId: "rec-1", spaceId: "space-1", date: "2026-12-01", reason: "PeriodClosed" },
      ],
      ["info", "recurrence_paused", { recurrenceId: "rec-2", spaceId: "space-1", reason: "PayerLeft" }],
      [
        "error",
        "recurrence_materialization_failed",
        { recurrenceId: "rec-3", spaceId: "space-2", error: "Error" },
      ],
    ]);
  });

  it("logs the SQLSTATE and the constraint of a database failure when it has them, and only then", async () => {
    const { ticks, logged } = started({
      occurrences: [],
      paused: [],
      failures: [
        {
          recurrenceId: "rec-1",
          spaceId: "space-1",
          error: "DrizzleQueryError",
          code: "23505",
          constraint: "recurrence_occurrences_date_uq",
        },
        { recurrenceId: "rec-2", spaceId: "space-1", error: "DrizzleQueryError", code: "40001" },
      ],
    });
    await ticks[0]!.job();
    expect(logged).toStrictEqual([
      [
        "error",
        "recurrence_materialization_failed",
        {
          recurrenceId: "rec-1",
          spaceId: "space-1",
          error: "DrizzleQueryError",
          code: "23505",
          constraint: "recurrence_occurrences_date_uq",
        },
      ],
      [
        "error",
        "recurrence_materialization_failed",
        { recurrenceId: "rec-2", spaceId: "space-1", error: "DrizzleQueryError", code: "40001" },
      ],
    ]);
  });

  it("logs a PENDING or RECORDED occurrence never, and a skip with the reason it was refused for", async () => {
    const { ticks, logged } = started({
      occurrences: [
        occurrence("PENDING", null),
        occurrence("RECORDED", null),
        occurrence("SKIPPED", "SpaceArchived"),
      ],
      paused: [],
      failures: [],
    });
    await ticks[0]!.job();
    expect(logged.map(([, event, data]) => [event, data?.reason])).toEqual([
      ["recurrence_occurrence_skipped", "SpaceArchived"],
    ]);
  });

  it("logs only the fields it names, never an error message, a query or its parameters", async () => {
    // What a failure would carry if a later change put more on it: none of it may reach the logs.
    const leaky = {
      recurrenceId: "rec-1",
      spaceId: "space-1",
      error: "DrizzleQueryError",
      code: "23505",
      message: 'duplicate key value violates unique constraint (Key (description)=(Ana"s rent))',
      query: 'insert into "transactions" ("description") values ($1)',
      params: ["Ana's rent"],
    };
    const leakyPause = {
      recurrenceId: "rec-2",
      spaceId: "space-1",
      reason: "PayerLeft",
      message: "Juan left",
    };
    const { ticks, logged } = started({ occurrences: [], paused: [leakyPause], failures: [leaky] });
    await ticks[0]!.job();
    expect(logged).toStrictEqual([
      ["info", "recurrence_paused", { recurrenceId: "rec-2", spaceId: "space-1", reason: "PayerLeft" }],
      [
        "error",
        "recurrence_materialization_failed",
        { recurrenceId: "rec-1", spaceId: "space-1", error: "DrizzleQueryError", code: "23505" },
      ],
    ]);
  });

  it("logs nothing for a run that did nothing", async () => {
    const { ticks, logged } = started({ occurrences: [], paused: [], failures: [] });
    await ticks[0]!.job();
    expect(logged).toStrictEqual([]);
  });

  it("lets a run that throws reject, for its scheduler to report and run again, and logs nothing itself", async () => {
    const { ticks, logged } = started(new Error("connection refused"));
    await expect(ticks[0]!.job()).rejects.toThrow("connection refused");
    expect(logged).toStrictEqual([]);
  });

  it("returns the function that stops the scheduler", () => {
    let stopped = 0;
    const stop = startRecurrenceJob(
      {
        materialize: async () => ({ occurrences: [], paused: [], failures: [] }),
        scheduler: { every: () => () => (stopped += 1) },
        logger: { info: () => undefined, error: () => undefined },
      },
      1000,
    );
    stop();
    expect(stopped).toBe(1);
  });
});

describe("the report of a run that failed (HU-E4-12)", () => {
  const reported = (error: unknown) => {
    const logged: Logged[] = [];
    logJobFailure({
      info: (event, data) => logged.push(["info", event, data]),
      error: (event, data) => logged.push(["error", event, data]),
    })(error);
    return logged;
  };

  it("logs the error's name and the SQLSTATE of the database error behind it, and nothing else", () => {
    // What Drizzle throws when the connection drops: a plain Error that holds the query, with the pg error as cause.
    const driver = Object.assign(new Error("terminating connection for user ana@example.com"), {
      code: "57P01",
      detail: "Key (email)=(ana@example.com) is held",
      severity: "FATAL",
    });
    const drizzle = new Error("Failed query: select * from users where email = $1\nparams: ana@example.com", {
      cause: driver,
    });
    expect(reported(drizzle)).toStrictEqual([
      ["error", "recurrence_job_failed", { name: "Error", code: "57P01" }],
    ]);
  });

  it("adds the constraint when the database error names one", () => {
    const driver = Object.assign(new Error("duplicate key value (ana@example.com)"), {
      code: "23505",
      constraint: "recurrence_occurrences_date_uq",
    });
    expect(reported(new Error("Failed query", { cause: driver }))).toStrictEqual([
      [
        "error",
        "recurrence_job_failed",
        { name: "Error", code: "23505", constraint: "recurrence_occurrences_date_uq" },
      ],
    ]);
  });

  it("reads the code from the error itself when it has no cause, and only a string code", () => {
    const direct = Object.assign(new TypeError("password authentication failed"), { code: "28P01" });
    const numeric = Object.assign(new Error("boom"), { code: 57014 });
    expect(reported(direct)).toStrictEqual([
      ["error", "recurrence_job_failed", { name: "TypeError", code: "28P01" }],
    ]);
    expect(reported(numeric)).toStrictEqual([["error", "recurrence_job_failed", { name: "Error" }]]);
  });

  it("logs a plain Error as its name alone, and a thrown value that is no Error as NonErrorThrown", () => {
    expect(reported(new Error("connect ECONNREFUSED postgres://hearth:secret@db:5432/hearth"))).toStrictEqual(
      [["error", "recurrence_job_failed", { name: "Error" }]],
    );
    expect(reported("a string with a secret")).toStrictEqual([
      ["error", "recurrence_job_failed", { name: "NonErrorThrown" }],
    ]);
  });
});
