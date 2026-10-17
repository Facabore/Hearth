import type { Result } from "@/shared/kernel";
import { newCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { categoryById, groupById } from "./lookups";

/** HU-E3-02, HU-E3-04: a category in `groupId`, or a subcategory of `parentCategoryId` (the contract sends one). */
export type CreateCategory = (input: {
  spaceId: string;
  userId: string;
  groupId?: string;
  parentCategoryId?: string;
  name: string;
}) => Promise<Result<Category>>;

export const createCreateCategory =
  (deps: CategoriesDeps): CreateCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const categories = await deps.categories.listCategories(spaceId);
      const groups = await deps.categories.listGroups(spaceId);
      const parent =
        input.parentCategoryId === undefined ? undefined : categoryById(categories, input.parentCategoryId);
      if (parent !== undefined && !parent.ok) return parent;
      const group = groupById(groups, categories, parent?.value.groupId ?? input.groupId ?? "");
      if (!group.ok) return group;
      const category = newCategory({
        id: deps.ids.next<"Category">(),
        group: group.value,
        parent: parent?.value,
        name: input.name,
        now: deps.clock.now(),
        categories,
      });
      if (!category.ok) return category;
      await deps.categories.addCategories([category.value]);
      return category;
    });
