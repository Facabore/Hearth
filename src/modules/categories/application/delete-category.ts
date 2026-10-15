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
      const category = categoryById(
        await deps.categories.listCategories(manager.value.spaceId),
        input.categoryId,
      );
      if (!category.ok) return category;
      if (await deps.usage.isCategoryReferenced(category.value.id)) return err(domainError("CategoryInUse"));
      // D8 (Task 0a): logical; the row stays, and lists, lookups and name checks skip it.
      await deps.categories.deleteCategory(manager.value.spaceId, category.value.id, deps.clock.now());
      return ok(undefined);
    });
