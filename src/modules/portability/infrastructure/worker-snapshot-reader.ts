import { isErr, type Result } from "@/shared/kernel";
import type { SourceSnapshot } from "../domain/source-snapshot";
import { MONEY_MANAGER_READ, MoneyManagerAdapter } from "./money-manager-adapter";
import { extractInWorker } from "./sqlite-extract";

/** Design §3.5: how long a file's reads may take before the worker is terminated (`ImportTimedOut`). */
export const IMPORT_TIME_LIMIT_MS = 30_000;

/**
 * Design §3.5: a Money Manager upload read off the server's thread. The cheap checks (size, zip, SQLite header) run
 * here; the SQLite reads run in a worker terminated after `timeoutMs`; the snapshot is built here from their rows.
 */
export const createWorkerSnapshotReader = (
  timeoutMs = IMPORT_TIME_LIMIT_MS,
): { read(bytes: Uint8Array): Promise<Result<SourceSnapshot>> } => {
  const adapter = new MoneyManagerAdapter();
  return {
    read: async (bytes): Promise<Result<SourceSnapshot>> => {
      const checked = adapter.checkUpload(bytes);
      if (isErr(checked)) return checked;
      return adapter.fromExtracted(await extractInWorker(bytes, MONEY_MANAGER_READ, timeoutMs));
    },
  };
};
