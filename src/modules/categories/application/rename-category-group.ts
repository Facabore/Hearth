import { domainError, err, ok, type Result } from "@/shared/kernel";
import { renameGroup, restyleGroup, type CategoryGroup } from "../domain/category";
import { styleChangeOf, type CategoryColor, type IconInput } from "../domain/category-style";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

/** HU-E3-02, HU-E3-05, ruling P61: renames and/or restyles a group; its categories keep their own styles. */
export type RenameCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
  name?: string;
  icon?: IconInput;
  color?: CategoryColor;
}) => Promise<Result<CategoryGroup>>;

export const createRenameCategoryGroup =
  (deps: CategoriesDeps): RenameCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      await deps.categories.lockTree(manager.value.spaceId);
      const groups = await deps.categories.listGroups(manager.value.spaceId);
      const group = groups.find((g) => g.id === input.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const renamed = input.name === undefined ? ok(group) : renameGroup(group, input.name, groups);
      if (!renamed.ok) return renamed;
      const style = styleChangeOf(input);
      if (!style.ok) return style;
      const updated = restyleGroup(renamed.value, style.value);
      await deps.categories.saveGroup(updated);
      return ok(updated);
    });
