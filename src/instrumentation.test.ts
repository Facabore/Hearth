import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startRecurrenceJob } from "@/composition/recurrence-job";
import { startExchangeRateJob } from "@/composition/exchange-rate-job";
import { startImportSnapshotJob } from "@/modules/portability/application";
import { register } from "./instrumentation";

const logger = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

// The job's wiring is pinned without a database: the container and the job are stand-ins.
vi.mock("@/composition/recurrence-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composition/recurrence-job")>()),
  startRecurrenceJob: vi.fn(),
}));
vi.mock("@/composition/exchange-rate-job", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composition/exchange-rate-job")>()),
  startExchangeRateJob: vi.fn(),
}));
vi.mock("@/modules/portability/application", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/portability/application")>()),
  startImportSnapshotJob: vi.fn(),
}));
const getContainer = vi.hoisted(() => vi.fn());
vi.mock("@/composition/container", () => ({ getContainer }));

const VALID = {
  DATABASE_URL: "postgres://hearth:secret@db:5432/hearth",
  BETTER_AUTH_SECRET: "a-secret-of-at-least-thirty-two-chars!",
  BETTER_AUTH_URL: "https://hearth.example.com",
};

beforeEach(() => {
  getContainer.mockReset().mockReturnValue({
    ledger: { materializeDueOccurrences: "materialize" },
    rates: { repository: "rate-repository" },
    portability: { removeExpiredSnapshots: "remove-expired-snapshots" },
    logger,
  });
  vi.mocked(startRecurrenceJob).mockReset();
  vi.mocked(startExchangeRateJob).mockReset();
  vi.mocked(startImportSnapshotJob).mockReset();
  logger.info.mockClear();
  logger.error.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const stubEnv = (vars: Record<string, string>) => {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
};

describe("register", () => {
  it("exits with status 1 naming the missing variable when the Node.js server starts", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs", BETTER_AUTH_SECRET: "" });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("BETTER_AUTH_SECRET");
    expect(String(error.mock.calls[0]?.[0])).not.toContain(VALID.DATABASE_URL);
    expect(vi.mocked(startRecurrenceJob)).not.toHaveBeenCalled();
  });

  it("starts normally with a valid environment", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs" });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await register();
    expect(exit).not.toHaveBeenCalled();
  });

  it("builds no container when both jobs are off, as before the exchange-rate job", async () => {
    stubEnv({
      ...VALID,
      NEXT_RUNTIME: "nodejs",
      RECURRENCE_JOB_INTERVAL_SECONDS: "0",
      EXCHANGE_RATE_JOB_INTERVAL_SECONDS: "0",
      IMPORT_SNAPSHOT_JOB_INTERVAL_SECONDS: "0",
    });
    await register();
    expect(getContainer).not.toHaveBeenCalled();
  });

  it("does nothing outside the Node.js runtime", async () => {
    stubEnv({ NEXT_RUNTIME: "edge", BETTER_AUTH_SECRET: "" });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await register();
    expect(exit).not.toHaveBeenCalled();
    expect(vi.mocked(startRecurrenceJob)).not.toHaveBeenCalled();
  });

  it("starts the recurring-transactions job every RECURRENCE_JOB_INTERVAL_SECONDS, and not at all with 0 (HU-E4-12)", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs", RECURRENCE_JOB_INTERVAL_SECONDS: "120" });
    await register();
    expect(vi.mocked(startRecurrenceJob)).toHaveBeenCalledWith(
      expect.objectContaining({ materialize: "materialize" }),
      120_000,
    );
    vi.mocked(startRecurrenceJob).mockClear();
    stubEnv({ RECURRENCE_JOB_INTERVAL_SECONDS: "0" });
    await register();
    expect(vi.mocked(startRecurrenceJob)).not.toHaveBeenCalled();
  });

  it("runs the job every 5 minutes when the interval is not set (HU-E4-12)", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs" });
    await register();
    expect(vi.mocked(startRecurrenceJob).mock.calls.map(([, intervalMs]) => intervalMs)).toEqual([300_000]);
  });

  it("starts the exchange-rate job every EXCHANGE_RATE_JOB_INTERVAL_SECONDS, a day by default, and not at all with 0 (D30)", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs" });
    await register();
    expect(vi.mocked(startExchangeRateJob)).toHaveBeenCalledWith(
      expect.objectContaining({ repository: "rate-repository", sources: expect.any(Array) }),
      86_400_000,
    );
    vi.mocked(startExchangeRateJob).mockClear();
    stubEnv({ EXCHANGE_RATE_JOB_INTERVAL_SECONDS: "3600" });
    await register();
    expect(vi.mocked(startExchangeRateJob)).toHaveBeenCalledWith(expect.anything(), 3_600_000);
    vi.mocked(startExchangeRateJob).mockClear();
    stubEnv({ EXCHANGE_RATE_JOB_INTERVAL_SECONDS: "0" });
    await register();
    expect(vi.mocked(startExchangeRateJob)).not.toHaveBeenCalled();
  });

  it("starts the import snapshot cleanup every IMPORT_SNAPSHOT_JOB_INTERVAL_SECONDS, a day by default, and not at all with 0 (D28)", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs" });
    await register();
    expect(vi.mocked(startImportSnapshotJob)).toHaveBeenCalledWith(
      expect.objectContaining({ removeExpiredSnapshots: "remove-expired-snapshots" }),
      86_400_000,
    );
    vi.mocked(startImportSnapshotJob).mockClear();
    stubEnv({ IMPORT_SNAPSHOT_JOB_INTERVAL_SECONDS: "0" });
    await register();
    expect(vi.mocked(startImportSnapshotJob)).not.toHaveBeenCalled();
  });

  it("never starts the job during `next build` (NEXT_PHASE phase-production-build)", async () => {
    stubEnv({
      ...VALID,
      NEXT_RUNTIME: "nodejs",
      NEXT_PHASE: "phase-production-build",
      RECURRENCE_JOB_INTERVAL_SECONDS: "120",
    });
    await register();
    expect(vi.mocked(startRecurrenceJob)).not.toHaveBeenCalled();
  });

  it("logs a run that throws as recurrence_job_failed with the error's name only, and runs again", async () => {
    vi.useFakeTimers();
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs", RECURRENCE_JOB_INTERVAL_SECONDS: "1" });
    let runs = 0;
    // Through the real TimerScheduler that register() builds, run a job that always throws instead of the
    // recurring-transactions one.
    vi.mocked(startRecurrenceJob).mockImplementation((deps) =>
      deps.scheduler.every(1000, async () => {
        runs += 1;
        throw new TypeError("connect ECONNREFUSED postgres://hearth:secret@db:5432/hearth");
      }),
    );
    await register();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
    expect(logger.error.mock.calls).toEqual([
      ["recurrence_job_failed", { name: "TypeError" }],
      ["recurrence_job_failed", { name: "TypeError" }],
    ]);
    // Stops the timer before the test ends.
    vi.clearAllTimers();
  });

  it("logs a database failure as its name and SQLSTATE, never the query, a parameter or the message", async () => {
    vi.useFakeTimers();
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs" });
    // What Drizzle throws when the connection drops: a plain Error that holds the query, with the pg error as cause.
    const driver = Object.assign(new Error("terminating connection for user ana@example.com"), {
      code: "57P01",
    });
    vi.mocked(startRecurrenceJob).mockImplementation((deps) =>
      deps.scheduler.every(1000, async () => {
        throw new Error("Failed query: select * from users where email = $1 -- params: ana@example.com", {
          cause: driver,
        });
      }),
    );
    await register();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error.mock.calls).toStrictEqual([
      ["recurrence_job_failed", { name: "Error", code: "57P01" }],
    ]);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("ana@example.com");
    vi.clearAllTimers();
  });

  it("logs a thrown value that is no Error as NonErrorThrown", async () => {
    vi.useFakeTimers();
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs" });
    vi.mocked(startRecurrenceJob).mockImplementation((deps) =>
      deps.scheduler.every(1000, async () => {
        throw "a string with a secret";
      }),
    );
    await register();
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.error.mock.calls).toEqual([["recurrence_job_failed", { name: "NonErrorThrown" }]]);
    vi.clearAllTimers();
  });
});
