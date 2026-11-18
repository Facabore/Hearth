import type { SpaceRepository } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import type { CategoriesDeps } from "./deps";
import { createListCategories, type CategoryGroupView, type CategoryUsageCounts } from "./list-categories";

/** #338: one of the viewer's spaces with its category tree, as that space's own list answers it. */
export interface MyCategories {
  readonly spaceId: string;
  readonly groups: readonly CategoryGroupView[];
}

export type ListMyCategories = (input: {
  userId: string;
  includeArchived: boolean;
}) => Promise<Result<MyCategories[]>>;

export interface ListMyCategoriesDeps extends CategoriesDeps {
  readonly counts: CategoryUsageCounts;
  readonly spaces: Pick<SpaceRepository, "listForUser">;
}

/**
 * #338: the category tree of each of the viewer's active spaces, personal included, in one read, for the filters of
 * the personal Movimientos across every space (ruling P319). Each space goes through ListCategories, so it authorizes
 * as that list does; a space it refuses is left out.
 */
export const createListMyCategories = (deps: ListMyCategoriesDeps): ListMyCategories => {
  const listCategories = createListCategories(deps);
  return async ({ userId, includeArchived }) => {
    const spaces = await deps.spaces.listForUser(userId);
    const trees = await Promise.all(
      spaces.map(async (space): Promise<MyCategories | null> => {
        const groups = await listCategories({ spaceId: space.id, userId, includeArchived });
        return groups.ok ? { spaceId: space.id, groups: groups.value } : null;
      }),
    );
    return ok(trees.filter((tree) => tree !== null));
  };
};
