import { ok, type Result } from "@/shared/kernel";
import { reviseCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById, groupById } from "./lookups";

export type UpdateCategory = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
  name?: string;
  groupId?: string;
}) => Promise<Result<Category>>;

/** HU-E3-02: rename and/or move; existing transactions keep the category (its id never changes). */
export const createUpdateCategory =
  (deps: CategoriesDeps): UpdateCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const categories = await deps.categories.listCategories(spaceId);
      const category = categoryById(categories, input.categoryId);
      if (!category.ok) return category;
      const target =
        input.groupId === undefined
          ? ok(undefined)
          : groupById(await deps.categories.listGroups(spaceId), categories, input.groupId);
      if (!target.ok) return target;
      const revised = reviseCategory(category.value, { name: input.name, group: target.value }, categories);
      if (!revised.ok) return revised;
      await deps.categories.saveCategories([revised.value]);
      return revised;
    });
