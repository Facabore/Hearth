import type { Result } from "@/shared/kernel";
import { newGroup, type CategoryGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type CreateCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  name: string;
}) => Promise<Result<CategoryGroup>>;

export const createCreateCategoryGroup =
  (deps: CategoriesDeps): CreateCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const group = newGroup({
        id: deps.ids.next<"CategoryGroup">(),
        spaceId,
        name: input.name,
        now: deps.clock.now(),
        groups: await deps.categories.listGroups(spaceId),
      });
      if (!group.ok) return group;
      await deps.categories.addGroups([group.value]);
      return group;
    });
