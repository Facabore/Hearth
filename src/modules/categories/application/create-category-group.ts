import type { Result } from "@/shared/kernel";
import { newGroup, type CategoryGroup } from "../domain/category";
import { styleChangeOf, type CategoryColor, type IconInput } from "../domain/category-style";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type CreateCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  name: string;
  /** HU-E3-05: without them, the group takes the custom style (`tag`, `GRAPHITE`). */
  icon?: IconInput;
  color?: CategoryColor;
}) => Promise<Result<CategoryGroup>>;

export const createCreateCategoryGroup =
  (deps: CategoriesDeps): CreateCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const style = styleChangeOf(input);
      if (!style.ok) return style;
      const group = newGroup({
        id: deps.ids.next<"CategoryGroup">(),
        spaceId,
        name: input.name,
        now: deps.clock.now(),
        groups: await deps.categories.listGroups(spaceId),
        style: style.value,
      });
      if (!group.ok) return group;
      await deps.categories.addGroups([group.value]);
      return group;
    });
