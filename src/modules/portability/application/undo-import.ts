import { ok, type Result } from "@/shared/kernel";
import { undoBatch } from "../domain/import-batch";
import { authorizeImporter, ownBatch } from "./import-access";
import type { ImportDeps } from "./import-ports";

export interface UndoneImport {
  readonly id: string;
  readonly status: "UNDONE";
  /** The batch's movements this undo deleted; one the person had deleted already is not counted. */
  readonly movementsDeleted: number;
  readonly accountsArchived: number;
  readonly categoriesArchived: number;
  /** P337: groups the import created or restored that are left with no live category, archived again. */
  readonly categoryGroupsArchived: number;
  /** P337: seeded groups and categories "Archivar las de Hearth que no uses" archived, restored. */
  readonly hearthCategoriesRestored: number;
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
 * same file again brings everything back. A refusal (a movement in a closed period) undoes nothing. P337: a Persona's
 * settlements are deleted in their direct spaces too; the spaces and their guests stay. The seeded groups and
 * categories the import archived come back (groups first, with the categories archiving them took), and the groups it
 * created or restored that no live category is left in are archived.
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

      let movementsDeleted = 0;
      for (const movementId of created.movements) {
        const deleted = await deps.writer.deleteMovement({ ...who, movementId });
        if (!deleted.ok) return deleted;
        if (deleted.value) movementsDeleted += 1;
      }
      // P337: a Persona's settlements, each in its direct space; the space and its guest stay (no hard deletes).
      for (const { spaceId, movementId } of created.settlements) {
        const deleted = await deps.writer.deleteMovement({ spaceId, userId: input.userId, movementId });
        if (!deleted.ok) return deleted;
        if (deleted.value) movementsDeleted += 1;
      }
      const targets = await deps.writer.targetsOf(who.spaceId, who.userId);
      if (!targets.ok) return targets;
      const archivedNow = new Set([
        ...targets.value.accounts.filter((a) => a.archived).map((a) => a.id),
        ...targets.value.categories.filter((c) => c.archived).map((c) => c.id),
      ]);
      // P347: the targets hold no deleted category; one the person deleted (with its group) stays as it is, uncounted.
      const liveCategories = new Set(targets.value.categories.map((c) => c.id));
      let categoriesArchived = 0;
      // Subcategories were created after their parents: the reverse order archives them first.
      for (const categoryId of [...created.categories].reverse()) {
        if (!liveCategories.has(categoryId) || archivedNow.has(categoryId)) continue;
        if (await deps.writer.categoryInUse(who.spaceId, categoryId)) continue;
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
      // P337: what "Archivar las de Hearth que no uses" archived comes back, groups first; one live already stays.
      let hearthCategoriesRestored = 0;
      const archivedGroups = new Set(targets.value.groups.filter((g) => g.archived).map((g) => g.id));
      for (const groupId of created.archivedSeeded.groups) {
        if (!archivedGroups.has(groupId)) continue;
        const restored = await deps.writer.restoreCategoryGroup({ ...who, groupId });
        if (!restored.ok) return restored;
        hearthCategoriesRestored += 1;
      }
      const afterGroups = await deps.writer.targetsOf(who.spaceId, who.userId);
      if (!afterGroups.ok) return afterGroups;
      const stillArchived = new Set(afterGroups.value.categories.filter((c) => c.archived).map((c) => c.id));
      for (const categoryId of created.archivedSeeded.categories) {
        if (!stillArchived.has(categoryId)) continue;
        const restored = await deps.writer.restoreCategory({ ...who, categoryId });
        if (!restored.ok) return restored;
        hearthCategoriesRestored += 1;
      }
      // P337: a group the import created or restored with no live category left goes back to the archive.
      let categoryGroupsArchived = 0;
      const tree = await deps.writer.targetsOf(who.spaceId, who.userId);
      if (!tree.ok) return tree;
      for (const groupId of created.groups) {
        const group = tree.value.groups.find((g) => g.id === groupId);
        if (group === undefined || group.archived) continue;
        if (tree.value.categories.some((c) => c.groupId === groupId && !c.archived)) continue;
        const archived = await deps.writer.archiveCategoryGroup({ ...who, groupId });
        if (!archived.ok) return archived;
        categoryGroupsArchived += 1;
      }
      await deps.batches.save(undone.value);
      return ok({
        id: undone.value.id,
        status: "UNDONE" as const,
        movementsDeleted,
        accountsArchived,
        categoriesArchived,
        categoryGroupsArchived,
        hearthCategoriesRestored,
      });
    });
