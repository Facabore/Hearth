import { describe, expect, it, vi } from "vitest";
import type { Scheduler } from "@/shared/kernel";
import { startImportSnapshotJob } from "./import-snapshot-job";

/** A scheduler that remembers its interval and runs the job when told to. */
const manualScheduler = () => {
  let job: (() => Promise<void>) | null = null;
  const scheduler: Scheduler & { interval: number | null } = {
    interval: null,
    every(intervalMs, run) {
      scheduler.interval = intervalMs;
      job = run;
      return () => undefined;
    },
  };
  return { scheduler, run: () => job!() };
};

describe("the import snapshot cleanup job (D28, design §3.5)", () => {
  it("removes the expired snapshots on every run and logs how many, never what they held", async () => {
    const { scheduler, run } = manualScheduler();
    const info = vi.fn();
    const removeExpiredSnapshots = vi.fn().mockResolvedValue(3);

    startImportSnapshotJob({ removeExpiredSnapshots, scheduler, logger: { info } }, 86_400_000);
    await run();

    expect(scheduler.interval).toBe(86_400_000);
    expect(removeExpiredSnapshots).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("import_snapshots_removed", { count: 3 });
  });
});
