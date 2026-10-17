import { ok, type Result } from "@/shared/kernel";
import { archivedTree } from "../domain/category";
import { authorizeManager } from "./authorize";
import { viewOf, type CategoryView } from "./category-view";
import type { CategoriesDeps } from "./deps";
import { categoryById } from "./lookups";

export type ArchiveCategory = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
}) => Promise<Result<CategoryView>>;

export const createArchiveCategory =
  (deps: CategoriesDeps): ArchiveCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const categories = await deps.categories.listCategories(spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      // HU-E3-04: its subcategories are archived with it.
      const archived = archivedTree(category.value, categories, deps.clock.now());
      await deps.categories.saveCategories(archived);
      // HU-E3-05: a subcategory answers with its parent's style.
      return ok(viewOf(archived[0]!, categories));
    });
