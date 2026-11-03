import type { Category, CategoryGroup } from "../domain/category";

export interface CategoryRepository {
  /**
   * Ruling P90: serializes the writers of one space's category tree. Taken first thing after authorization by every
   * use case that writes groups or categories, it joins the caller's transaction and is released when it ends, so the
   * writer that waits reads what the first one wrote and decides on that (a name taken, a parent gone or archived).
   */
  lockTree(spaceId: string): Promise<void>;
  /**
   * Issue #245: the shared side of `lockTree`, for a writer outside this module that is about to reference one of the
   * space's categories (a movement, a budget-line mapping). It waits for a tree write in progress, a delete above all,
   * and keeps the next one out until the caller's transaction ends; references run side by side.
   */
  lockTreeForReference(spaceId: string): Promise<void>;
  hasAny(spaceId: string): Promise<boolean>;
  addGroups(groups: readonly CategoryGroup[]): Promise<void>;
  addCategories(categories: readonly Category[]): Promise<void>;
  /** Every group of the space, archived ones included. */
  listGroups(spaceId: string): Promise<CategoryGroup[]>;
  /** Every category of the space that is not deleted (D8), archived ones included. */
  listCategories(spaceId: string): Promise<Category[]>;
  /** Persists name, style and archive state. */
  saveGroup(group: CategoryGroup): Promise<void>;
  /** Persists name, group, parent, style and archive state of each category. */
  saveCategories(categories: readonly Category[]): Promise<void>;
  /** D8: logical; the row and every reference to it stay, and `listCategories` skips it. */
  deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void>;
}
