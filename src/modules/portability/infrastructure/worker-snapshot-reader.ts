import { domainError, err, isErr, type Result } from "@/shared/kernel";
import type { SourceSnapshot } from "../domain/source-snapshot";
import { MONEY_MANAGER_LAYOUTS, MoneyManagerAdapter } from "./money-manager-adapter";
import { extractInWorker } from "./sqlite-extract";

/** Design §3.5: how long a file's reads may take before the worker is terminated (`ImportTimedOut`). */
export const IMPORT_TIME_LIMIT_MS = 30_000;

/** Design §3.5: how many uploads one server process reads at once; one more answers 429 `TooManyRequests`. */
export const MAX_CONCURRENT_IMPORTS = 2;

/**
 * Design §3.5: a Money Manager upload (Android or iOS) read off the server's thread. The cheap checks (size, zip, SQLite header) run
 * here; the SQLite reads run in a worker terminated after `timeoutMs`; the snapshot is built here from their rows. At
 * most `maxConcurrent` reads run at once: one more is refused at once with `TooManyRequests` (never queued), so a
 * burst of uploads cannot hold the server's memory.
 */
export const createWorkerSnapshotReader = (
  timeoutMs = IMPORT_TIME_LIMIT_MS,
  maxConcurrent = MAX_CONCURRENT_IMPORTS,
): { read(bytes: Uint8Array): Promise<Result<SourceSnapshot>> } => {
  const adapter = new MoneyManagerAdapter();
  let running = 0;
  return {
    read: async (bytes): Promise<Result<SourceSnapshot>> => {
      const checked = adapter.checkUpload(bytes);
      if (isErr(checked)) return checked;
      if (running >= maxConcurrent) return err(domainError("TooManyRequests"));
      running += 1;
      try {
        // The first layout whose tables the file has (Android, then iOS); a file of neither is not recognized.
        for (const layout of MONEY_MANAGER_LAYOUTS) {
          const extracted = await extractInWorker(bytes, layout.spec, timeoutMs);
          if (extracted.kind !== "notRecognized") return adapter.fromExtracted(extracted, layout);
        }
        return adapter.fromExtracted({ kind: "notRecognized" });
      } finally {
        running -= 1;
      }
    },
  };
};
