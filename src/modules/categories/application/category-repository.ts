import type { Category, CategoryGroup } from "../domain/category";

export interface CategoryRepository {
  hasAny(spaceId: string): Promise<boolean>;
  addGroups(groups: readonly CategoryGroup[]): Promise<void>;
  addCategories(categories: readonly Category[]): Promise<void>;
  /** Every group of the space, archived ones included. */
  listGroups(spaceId: string): Promise<CategoryGroup[]>;
  /** Every category of the space, archived ones included. */
  listCategories(spaceId: string): Promise<Category[]>;
  /** Persists name and archive state. */
  saveGroup(group: CategoryGroup): Promise<void>;
  /** Persists name, group and archive state of each category. */
  saveCategories(categories: readonly Category[]): Promise<void>;
  deleteCategory(spaceId: string, categoryId: string): Promise<void>;
}
