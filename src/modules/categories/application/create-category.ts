import type { Result } from "@/shared/kernel";
import { newCategory, type Category } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";
import { groupById } from "./lookups";

export type CreateCategory = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
  name: string;
}) => Promise<Result<Category>>;

export const createCreateCategory =
  (deps: CategoriesDeps): CreateCategory =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      const categories = await deps.categories.listCategories(spaceId);
      const group = groupById(await deps.categories.listGroups(spaceId), categories, input.groupId);
      if (!group.ok) return group;
      const category = newCategory({
        id: deps.ids.next<"Category">(),
        group: group.value,
        name: input.name,
        now: deps.clock.now(),
        categories,
      });
      if (!category.ok) return category;
      await deps.categories.addCategories([category.value]);
      return category;
    });
