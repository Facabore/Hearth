import { domainError, err, type Result } from "@/shared/kernel";
import { renameGroup, type CategoryGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type RenameCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
  name: string;
}) => Promise<Result<CategoryGroup>>;

export const createRenameCategoryGroup =
  (deps: CategoriesDeps): RenameCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const groups = await deps.categories.listGroups(manager.value.spaceId);
      const group = groups.find((g) => g.id === input.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const renamed = renameGroup(group, input.name, groups);
      if (!renamed.ok) return renamed;
      await deps.categories.saveGroup(renamed.value);
      return renamed;
    });
