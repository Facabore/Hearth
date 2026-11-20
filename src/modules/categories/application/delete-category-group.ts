import { domainError, err, ok, type Result } from "@/shared/kernel";
import { deleteGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type DeleteCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
}) => Promise<Result<void>>;

/**
 * P347 (owner: "los grupos deberían poderse borrar", "Sí, eliminar igual"): deletes a group with its categories and
 * subcategories, logically (D8), even when movements, budget lines or recurrences use them; they keep naming those in
 * history. Whoever manages the tree may (HU-E3-02), under the tree lock (ruling P90); a deleted or unknown group is
 * CategoryGroupNotFound.
 */
export const createDeleteCategoryGroup =
  (deps: CategoriesDeps): DeleteCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const groups = await deps.categories.listGroups(spaceId);
      const group = groups.find((g) => g.id === input.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const deleted = deleteGroup(
        group,
        groups,
        await deps.categories.listCategories(spaceId),
        deps.clock.now(),
      );
      await deps.categories.deleteGroup(deleted.group, deleted.categories);
      await deps.categories.saveGroupPositions(spaceId, deleted.positions);
      return ok(undefined);
    });
