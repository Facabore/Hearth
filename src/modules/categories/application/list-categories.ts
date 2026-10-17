import { authorizeSpaceAction } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import type { CategoryGroup } from "../domain/category";
import { viewOf, type CategoryView } from "./category-view";
import type { CategoriesDeps } from "./deps";

/** HU-E3-04, HU-E3-05: a category with its subcategories, each sorted by name; each shows its style. */
export interface CategoryNode extends CategoryView {
  readonly subcategories: readonly CategoryView[];
}

export interface CategoryGroupView extends CategoryGroup {
  readonly categories: readonly CategoryNode[];
}

export type ListCategories = (input: {
  spaceId: string;
  userId: string;
  includeArchived: boolean;
}) => Promise<Result<CategoryGroupView[]>>;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");

export const createListCategories =
  (deps: CategoriesDeps): ListCategories =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const { spaceId } = membership.value;
    const visible = <T extends { archivedAt: Date | null }>(rows: readonly T[]): T[] =>
      input.includeArchived ? [...rows] : rows.filter((row) => row.archivedAt === null);
    const groups = await deps.categories.listGroups(spaceId);
    const categories = await deps.categories.listCategories(spaceId);
    return ok(
      visible(groups)
        .sort(byName)
        .map((group) => ({
          ...group,
          categories: visible(categories.filter((c) => c.groupId === group.id && c.parentCategoryId === null))
            .sort(byName)
            .map((category) => ({
              ...viewOf(category, categories),
              // HU-E3-05: derived on every read, so a subcategory follows its parent's style.
              subcategories: visible(categories.filter((c) => c.parentCategoryId === category.id))
                .sort(byName)
                .map((subcategory) => viewOf(subcategory, categories)),
            })),
        })),
    );
  };
