import type { Env } from "@/shared/infrastructure/env";

/**
 * Next.js startup hook: refuse to serve with a missing or invalid environment (HU-E0-07), then start the
 * in-container job that records due recurring transactions (HU-E4-12, ruling P20) unless its interval is 0 or the
 * app is being built.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadEnv } = await import("@/shared/infrastructure/env");
  let env: Env;
  try {
    env = loadEnv();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
    return;
  }
  // `next build` never starts the job: Next.js skips register() then, and this keeps the gate explicit.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (env.RECURRENCE_JOB_INTERVAL_SECONDS === 0) return;
  const [{ getContainer }, { logJobFailure, startRecurrenceJob }, { TimerScheduler }] = await Promise.all([
    import("@/composition/container"),
    import("@/composition/recurrence-job"),
    import("@/shared/infrastructure/timer-scheduler"),
  ]);
  const container = getContainer();
  startRecurrenceJob(
    {
      materialize: container.ledger.materializeDueOccurrences,
      scheduler: new TimerScheduler(logJobFailure(container.logger)),
      logger: container.logger,
    },
    env.RECURRENCE_JOB_INTERVAL_SECONDS * 1000,
  );
}
