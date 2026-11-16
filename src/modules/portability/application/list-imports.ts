import { ok, type Result } from "@/shared/kernel";
import { SNAPSHOT_RETENTION_DAYS, type ImportBatch } from "../domain/import-batch";
import { authorizeImporter } from "./import-access";
import type { ImportDeps } from "./import-ports";

export interface ImportSummary {
  readonly id: string;
  readonly sourceApp: string;
  readonly status: ImportBatch["status"];
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly undoneAt: Date | null;
  readonly counts: ImportBatch["counts"];
}

export type ListImports = (input: {
  readonly spaceId: string;
  readonly userId: string;
}) => Promise<Result<ImportSummary[]>>;

/** Design §3.2: the space's past imports, newest first, with their counts and undo state. */
export const createListImports =
  (deps: Pick<ImportDeps, "access" | "batches">): ListImports =>
  async (input) => {
    const importer = await authorizeImporter(deps, input.spaceId, input.userId);
    if (!importer.ok) return importer;
    const batches = await deps.batches.listBySpace(importer.value.spaceId);
    return ok(
      batches.map((b) => ({
        id: b.id,
        sourceApp: b.sourceApp,
        status: b.status,
        createdAt: b.createdAt,
        confirmedAt: b.confirmedAt,
        undoneAt: b.undoneAt,
        counts: b.counts,
      })),
    );
  };

export type RemoveExpiredSnapshots = () => Promise<number>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Design §3.5: removes the snapshot of every batch confirmed, undone or abandoned more than
 * `SNAPSHOT_RETENTION_DAYS` ago, and answers how many. Not scheduled yet: a job calls it later.
 */
export const createRemoveExpiredSnapshots =
  (deps: Pick<ImportDeps, "batches" | "clock">): RemoveExpiredSnapshots =>
  () =>
    deps.batches.removeSnapshotsSettledBefore(
      new Date(deps.clock.now().getTime() - SNAPSHOT_RETENTION_DAYS * DAY_MS),
    );
