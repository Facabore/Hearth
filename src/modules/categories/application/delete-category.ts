import { domainError, err, ok, type Result } from "@/shared/kernel";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById } from "./lookups";

/**
 * Whether anything references a category (HU-E3-03). Bound to the ledger, where soft-deleted transactions still
 * count, and to budgeting, where every budget-line mapping counts, ended ones included (D8, HU-E6-04).
 */
export interface CategoryUsage {
  isCategoryReferenced(categoryId: string): Promise<boolean>;
}

export type DeleteCategory = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
}) => Promise<Result<void>>;

export const createDeleteCategory =
  (deps: CategoriesDeps & { readonly usage: CategoryUsage }): DeleteCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      await deps.categories.lockTree(manager.value.spaceId);
      const categories = await deps.categories.listCategories(manager.value.spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      // HU-E3-04, ruling P48: subcategories that are not deleted, archived ones included, keep their category.
      if (categories.some((c) => c.parentCategoryId === category.value.id))
        return err(domainError("CategoryInUse"));
      if (await deps.usage.isCategoryReferenced(category.value.id)) return err(domainError("CategoryInUse"));
      // D8 (Task 0a): logical; the row stays, and lists, lookups and name checks skip it.
      await deps.categories.deleteCategory(manager.value.spaceId, category.value.id, deps.clock.now());
      return ok(undefined);
    });
