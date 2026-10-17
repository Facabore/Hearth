import { domainError, err, type Result } from "@/shared/kernel";
import { restoreCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById } from "./lookups";

export type RestoreCategory = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
}) => Promise<Result<Category>>;

export const createRestoreCategory =
  (deps: CategoriesDeps): RestoreCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const categories = await deps.categories.listCategories(spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      const group = (await deps.categories.listGroups(spaceId)).find((g) => g.id === category.value.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      // HU-E3-04: a live subcategory's parent is never deleted (DeleteCategory), so it is in the list.
      const parent = categories.find((c) => c.id === category.value.parentCategoryId) ?? null;
      const restored = restoreCategory(category.value, group, parent);
      if (!restored.ok) return restored;
      await deps.categories.saveCategories([restored.value]);
      return restored;
    });
