import type { Scheduler } from "@/shared/kernel";

/**
 * HU-E4-12 (ruling P20): the in-container scheduler. A job runs at once, so a restart catches up what it missed, and
 * then `intervalMs` after each run ends, so two runs of one job never overlap. A job that throws is reported to
 * `onError` and runs again on the next tick, even when `onError` throws.
 */
export class TimerScheduler implements Scheduler {
  constructor(private readonly onError: (error: unknown) => void) {}

  every(intervalMs: number, job: () => Promise<void>): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        await job();
      } catch (error) {
        try {
          this.onError(error);
        } catch {
          // A reporter that fails must never stop the job: the next tick still runs.
        }
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }
}
