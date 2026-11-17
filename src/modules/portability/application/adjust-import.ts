import type { Result } from "@/shared/kernel";
import { draftSnapshot, type AccountMapping, type CategoryMapping } from "../domain/import-batch";
import { checkMappings } from "../domain/mapping-proposals";
import { authorizeImporter, ownBatch, priorLinksFor } from "./import-access";
import type { ImportDeps } from "./import-ports";
import { viewOf, type ImportView } from "./import-view";

/** Design §3.2's adjustments; each field left out keeps what the batch has, each mapping replaces its source's. */
export interface ImportChanges {
  readonly timeZone?: string;
  readonly accounts?: Readonly<Record<string, AccountMapping>>;
  readonly categories?: Readonly<Record<string, CategoryMapping>>;
  /** Replaces the whole list of likely duplicates to import anyway. */
  readonly includeDuplicates?: readonly string[];
}

export type AdjustImport = (input: {
  readonly spaceId: string;
  readonly userId: string;
  readonly importId: string;
  readonly changes: ImportChanges;
}) => Promise<Result<ImportView>>;

/** Design §3.2: changes a draft's mappings, checked against the snapshot and the space, and answers the new preview. */
export const createAdjustImport =
  (deps: ImportDeps): AdjustImport =>
  (input) =>
    deps.tm.run(async () => {
      const importer = await authorizeImporter(deps, input.spaceId, input.userId);
      if (!importer.ok) return importer;
      const batch = ownBatch(await deps.batches.findForUpdate(input.spaceId, input.importId), input.userId);
      if (!batch.ok) return batch;
      const snapshot = draftSnapshot(batch.value);
      if (!snapshot.ok) return snapshot;
      const targets = await deps.writer.targetsOf(input.spaceId, input.userId);
      if (!targets.ok) return targets;
      const current = batch.value.mappings;
      const { changes } = input;
      const links = await priorLinksFor(deps, input.spaceId, snapshot.value.sourceApp);
      const spaceCurrency = importer.value.currency;
      const mappings = checkMappings(
        snapshot.value,
        {
          timeZone: changes.timeZone ?? current.timeZone,
          accounts: { ...current.accounts, ...changes.accounts },
          categories: { ...current.categories, ...changes.categories },
          includeDuplicates: changes.includeDuplicates ?? current.includeDuplicates,
        },
        targets.value,
        links,
        spaceCurrency,
      );
      if (!mappings.ok) return mappings;
      const adjusted = { ...batch.value, mappings: mappings.value };
      await deps.batches.save(adjusted);
      return viewOf(deps, adjusted, snapshot.value, { targets: targets.value, links, spaceCurrency });
    });
