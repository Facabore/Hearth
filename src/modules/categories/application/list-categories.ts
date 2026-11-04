import { authorizeSpaceAction } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import type { CategoryGroup } from "../domain/category";
import { viewOf, type CategoryView } from "./category-view";
import type { CategoriesDeps } from "./deps";

/**
 * Ruling P297: how many live movements of a space name each category, by category id; one that none names is absent.
 * Computed on every read in one grouped query and never stored (D7). Bound to the ledger, which this module never
 * imports.
 */
export interface CategoryUsageCounts {
  usageCountsOf(spaceId: string): Promise<ReadonlyMap<string, number>>;
}

/** A category or subcategory as the list shows it: its style, and (P297) the movements that name it. */
export interface CountedCategoryView extends CategoryView {
  readonly usageCount: number;
}

/**
 * HU-E3-04, HU-E3-05: a category with its subcategories, each sorted by name; each shows its style. The groups come in
 * their own order (ruling P296).
 */
export interface CategoryNode extends CountedCategoryView {
  readonly subcategories: readonly CountedCategoryView[];
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
  (deps: CategoriesDeps & { readonly counts: CategoryUsageCounts }): ListCategories =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const { spaceId } = membership.value;
    const visible = <T extends { archivedAt: Date | null }>(rows: readonly T[]): T[] =>
      input.includeArchived ? [...rows] : rows.filter((row) => row.archivedAt === null);
    const groups = await deps.categories.listGroups(spaceId);
    const categories = await deps.categories.listCategories(spaceId);
    const counts = await deps.counts.usageCountsOf(spaceId);
    // P297: a subcategory's movements count toward the subcategory itself, never toward its parent.
    const counted = (category: (typeof categories)[number]): CountedCategoryView => ({
      ...viewOf(category, categories),
      usageCount: counts.get(category.id) ?? 0,
    });
    return ok(
      visible(groups)
        .sort((a, b) => a.position - b.position)
        .map((group) => ({
          ...group,
          categories: visible(categories.filter((c) => c.groupId === group.id && c.parentCategoryId === null))
            .sort(byName)
            .map((category) => ({
              ...counted(category),
              // HU-E3-05: derived on every read, so a subcategory follows its parent's style.
              subcategories: visible(categories.filter((c) => c.parentCategoryId === category.id))
                .sort(byName)
                .map(counted),
            })),
        })),
    );
  };
