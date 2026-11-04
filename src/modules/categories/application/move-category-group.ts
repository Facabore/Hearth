import { ok, type Result } from "@/shared/kernel";
import { placeGroup, type CategoryGroup, type GroupAnchor } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

/**
 * Ruling P296: places a group right before or right after another group of its space, so the screen moves it one place
 * up or down among the groups it shows. Whoever manages the tree may (HU-E3-02); the tree lock (ruling P90) serializes
 * moves with every other tree write, so each reads the order the one before it left. Answers every group of the space,
 * archived ones included, in their new order.
 */
export type MoveCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
  anchor: GroupAnchor;
}) => Promise<Result<CategoryGroup[]>>;

export const createMoveCategoryGroup =
  (deps: CategoriesDeps): MoveCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const groups = await deps.categories.listGroups(spaceId);
      const moved = placeGroup(groups, input.groupId, input.anchor);
      if (!moved.ok) return moved;
      await deps.categories.saveGroupPositions(spaceId, moved.value);
      const at = new Map(moved.value.map((g) => [g.id, g]));
      return ok(groups.map((g) => at.get(g.id) ?? g).sort((a, b) => a.position - b.position));
    });
