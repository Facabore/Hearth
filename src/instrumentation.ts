import type { Env } from "@/shared/infrastructure/env";

/**
 * Next.js startup hook: refuse to serve with a missing or invalid environment (HU-E0-07), then start the in-container
 * jobs, each unless its interval is 0 or the app is being built: the one that records due recurring transactions
 * (HU-E4-12, ruling P20) and the one that fetches daily exchange rates (D30).
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
  // `next build` never starts a job: Next.js skips register() then, and this keeps the gate explicit.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // With both jobs off, nothing is built at startup (the container is built on the first request instead).
  if (env.RECURRENCE_JOB_INTERVAL_SECONDS === 0 && env.EXCHANGE_RATE_JOB_INTERVAL_SECONDS === 0) return;
  const { getContainer } = await import("@/composition/container");
  const { TimerScheduler } = await import("@/shared/infrastructure/timer-scheduler");
  const container = getContainer();

  if (env.RECURRENCE_JOB_INTERVAL_SECONDS > 0) {
    const { logJobFailure, startRecurrenceJob } = await import("@/composition/recurrence-job");
    startRecurrenceJob(
      {
        materialize: container.ledger.materializeDueOccurrences,
        scheduler: new TimerScheduler(logJobFailure(container.logger)),
        logger: container.logger,
      },
      env.RECURRENCE_JOB_INTERVAL_SECONDS * 1000,
    );
  }

  if (env.EXCHANGE_RATE_JOB_INTERVAL_SECONDS > 0) {
    const [
      { logExchangeRateJobFailure, startExchangeRateJob },
      { createHttpGet },
      { EcbSource },
      { TrmSource },
      { clockFrom },
    ] = await Promise.all([
      import("@/composition/exchange-rate-job"),
      import("@/shared/infrastructure/http/http-get"),
      import("@/modules/rates/infrastructure/ecb-source"),
      import("@/modules/rates/infrastructure/trm-source"),
      import("@/shared/infrastructure/system-clock"),
    ]);
    const http = createHttpGet(15_000);
    startExchangeRateJob(
      {
        sources: [new EcbSource(http), new TrmSource(http)],
        repository: container.rates.repository,
        scheduler: new TimerScheduler(logExchangeRateJobFailure(container.logger)),
        clock: clockFrom(env.HEARTH_E2E_FIXED_NOW),
        logger: container.logger,
      },
      env.EXCHANGE_RATE_JOB_INTERVAL_SECONDS * 1000,
    );
  }
}
