import type { Scheduler } from "@/shared/kernel";
import type { RemoveExpiredSnapshots } from "./list-imports";

export interface ImportSnapshotJobDeps {
  readonly removeExpiredSnapshots: RemoveExpiredSnapshots;
  readonly scheduler: Scheduler;
  /** Only counts are logged, never a snapshot's contents (design §3.5). */
  readonly logger: { info(event: string, fields: Record<string, unknown>): void };
}

/**
 * D28, design §3.5: the in-container job that removes, every `intervalMs`, the snapshot of each import batch confirmed,
 * undone or abandoned more than 7 days ago; no endpoint triggers it. A removal is idempotent, so a restart or a second
 * container never does harm. A run that throws is its scheduler's to report and to run again.
 */
export const startImportSnapshotJob = (deps: ImportSnapshotJobDeps, intervalMs: number): (() => void) =>
  deps.scheduler.every(intervalMs, async () => {
    const count = await deps.removeExpiredSnapshots();
    deps.logger.info("import_snapshots_removed", { count });
  });
