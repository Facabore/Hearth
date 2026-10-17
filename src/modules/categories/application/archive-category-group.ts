import { domainError, err, ok, type Result } from "@/shared/kernel";
import { archiveGroup, type CategoryGroup } from "../domain/category";
import { authorizeManager } from "./authorize";
import type { CategoriesDeps } from "./deps";

export type ArchiveCategoryGroup = (input: {
  spaceId: string;
  userId: string;
  groupId: string;
}) => Promise<Result<CategoryGroup>>;

export const createArchiveCategoryGroup =
  (deps: CategoriesDeps): ArchiveCategoryGroup =>
  (input) =>
    deps.tm.run(async () => {
      const manager = await authorizeManager(deps.access, input.spaceId, input.userId);
      if (!manager.ok) return manager;
      const { spaceId } = manager.value;
      await deps.categories.lockTree(spaceId);
      const group = (await deps.categories.listGroups(spaceId)).find((g) => g.id === input.groupId);
      if (!group) return err(domainError("CategoryGroupNotFound"));
      const archived = archiveGroup(group, await deps.categories.listCategories(spaceId), deps.clock.now());
      await deps.categories.saveGroup(archived.group);
      await deps.categories.saveCategories(archived.categories);
      return ok(archived.group);
    });
