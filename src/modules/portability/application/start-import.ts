import { ok, type Result } from "@/shared/kernel";
import { NOTHING_CREATED, type ImportBatch } from "../domain/import-batch";
import { proposeMappings } from "../domain/mapping-proposals";
import { authorizeImporter, priorLinksFor } from "./import-access";
import type { ImportDeps } from "./import-ports";
import { viewOf, type ImportView } from "./import-view";

export type StartImport = (input: {
  readonly spaceId: string;
  readonly userId: string;
  /** The uploaded file; read in memory and never stored (design §3.5). */
  readonly bytes: Uint8Array;
}) => Promise<Result<ImportView>>;

/**
 * Design §3.2's upload: reads the file (off the server's thread, with a time limit), stores a DRAFT batch with its
 * hash, its snapshot and the proposed mappings, and answers the preview. Nothing reaches the ledger.
 */
export const createStartImport =
  (deps: ImportDeps): StartImport =>
  async (input) => {
    const importer = await authorizeImporter(deps, input.spaceId, input.userId);
    if (!importer.ok) return importer;
    const read = await deps.reader.read(input.bytes);
    if (!read.ok) return read;
    const snapshot = read.value;
    const fileSha256 = deps.digest(input.bytes);
    return deps.tm.run(async () => {
      const targets = await deps.writer.targetsOf(input.spaceId, input.userId);
      if (!targets.ok) return targets;
      const timeZone = await deps.userTimeZones.timeZoneOf(input.userId);
      const batch: ImportBatch = {
        id: deps.ids.next<"ImportBatch">(),
        spaceId: importer.value.spaceId,
        userId: input.userId,
        sourceApp: snapshot.sourceApp,
        fileSha256,
        status: "DRAFT",
        snapshot,
        mappings: proposeMappings(
          snapshot,
          targets.value,
          await priorLinksFor(deps, input.spaceId, snapshot.sourceApp),
          timeZone,
        ),
        counts: null,
        rowErrors: [],
        created: NOTHING_CREATED,
        createdAt: deps.clock.now(),
        confirmedAt: null,
        undoneAt: null,
      };
      await deps.batches.add(batch);
      const view = await viewOf(deps, batch, snapshot);
      return view.ok ? ok(view.value) : view;
    });
  };
