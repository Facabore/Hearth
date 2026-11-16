import { ok, type Result } from "@/shared/kernel";
import { undoBatch } from "../domain/import-batch";
import { authorizeImporter, ownBatch } from "./import-access";
import type { ImportDeps } from "./import-ports";

export interface UndoneImport {
  readonly id: string;
  readonly status: "UNDONE";
  readonly movementsDeleted: number;
  readonly accountsArchived: number;
  readonly categoriesArchived: number;
}

export type UndoImport = (input: {
  readonly spaceId: string;
  readonly userId: string;
  readonly importId: string;
}) => Promise<Result<UndoneImport>>;

/**
 * Design §3.2: in one transaction under the space lock (#89), logically deletes every movement the batch created
 * (D8, through the ledger's delete, which keeps the audit), then archives the categories and accounts it created that
 * no live movement uses any more; the batch becomes UNDONE and its links stop counting (design §3.3), so importing the
 * same file again brings everything back. A refusal (a movement in a closed period) undoes nothing.
 */
export const createUndoImport =
  (deps: ImportDeps): UndoImport =>
  (input) =>
    deps.tm.run(async () => {
      await deps.spaceLocks.lockForMoneyWrite(input.spaceId);
      const importer = await authorizeImporter(deps, input.spaceId, input.userId);
      if (!importer.ok) return importer;
      const who = { spaceId: importer.value.spaceId, userId: input.userId };
      const batch = ownBatch(await deps.batches.findForUpdate(who.spaceId, input.importId), input.userId);
      if (!batch.ok) return batch;
      const undone = undoBatch(batch.value, deps.clock.now());
      if (!undone.ok) return undone;
      const { created } = batch.value;

      for (const movementId of created.movements) {
        const deleted = await deps.writer.deleteMovement({ ...who, movementId });
        if (!deleted.ok) return deleted;
      }
      const targets = await deps.writer.targetsOf(who.spaceId, who.userId);
      if (!targets.ok) return targets;
      const archivedNow = new Set([
        ...targets.value.accounts.filter((a) => a.archived).map((a) => a.id),
        ...targets.value.categories.filter((c) => c.archived).map((c) => c.id),
      ]);
      let categoriesArchived = 0;
      // Subcategories were created after their parents: the reverse order archives them first.
      for (const categoryId of [...created.categories].reverse()) {
        if (archivedNow.has(categoryId) || (await deps.writer.categoryInUse(who.spaceId, categoryId)))
          continue;
        const archived = await deps.writer.archiveCategory({ ...who, categoryId });
        if (!archived.ok) return archived;
        categoriesArchived += 1;
      }
      let accountsArchived = 0;
      for (const accountId of created.accounts) {
        if (archivedNow.has(accountId) || (await deps.writer.accountInUse(who.spaceId, accountId))) continue;
        const archived = await deps.writer.archiveAccount({ ...who, accountId });
        if (!archived.ok) return archived;
        accountsArchived += 1;
      }
      await deps.batches.save(undone.value);
      return ok({
        id: undone.value.id,
        status: "UNDONE" as const,
        movementsDeleted: created.movements.length,
        accountsArchived,
        categoriesArchived,
      });
    });
