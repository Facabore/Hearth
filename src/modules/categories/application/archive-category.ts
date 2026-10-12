import { ok, type Result } from "@/shared/kernel";
import { archiveCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById } from "./lookups";

export type ArchiveCategory = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
}) => Promise<Result<Category>>;

export const createArchiveCategory =
  (deps: CategoriesDeps): ArchiveCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const category = categoryById(
        await deps.categories.listCategories(manager.value.spaceId),
        input.categoryId,
      );
      if (!category.ok) return category;
      const archived = archiveCategory(category.value, deps.clock.now());
      await deps.categories.saveCategories([archived]);
      return ok(archived);
    });
