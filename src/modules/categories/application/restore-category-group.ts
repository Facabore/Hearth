import { domainError, err, ok, type Result } from "@/shared/kernel";
import { restoreGroup, type CategoryGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type RestoreCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
}) => Promise<Result<CategoryGroup>>;

/**
 * P337: brings an archived group back with the categories archiving it took, so the seeded groups an import archived
 * ("Archivar las de Hearth que no uses") can be restored. Whoever manages the tree may (HU-E3-02), under the tree lock
 * (ruling P90).
 */
export const createRestoreCategoryGroup =
  (deps: CategoriesDeps): RestoreCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const group = (await deps.categories.listGroups(spaceId)).find((g) => g.id === input.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const restored = restoreGroup(group, await deps.categories.listCategories(spaceId));
      if (restored.group !== group) await deps.categories.saveGroup(restored.group);
      if (restored.categories.length > 0) await deps.categories.saveCategories(restored.categories);
      return ok(restored.group);
    });
