import type { Category, CategoryGroup } from "../domain/category";

export interface CategoryRepository {
  hasAny(spaceId: string): Promise<boolean>;
  addGroups(groups: readonly CategoryGroup[]): Promise<void>;
  addCategories(categories: readonly Category[]): Promise<void>;
  /** Every group of the space, archived ones included. */
  listGroups(spaceId: string): Promise<CategoryGroup[]>;
  /** Every category of the space that is not deleted (D8, Task 0a), archived ones included. */
  listCategories(spaceId: string): Promise<Category[]>;
  /** Persists name and archive state. */
  saveGroup(group: CategoryGroup): Promise<void>;
  /** Persists name, group and archive state of each category. */
  saveCategories(categories: readonly Category[]): Promise<void>;
  /** D8 (Task 0a): logical; the row and every reference to it stay, and `listCategories` skips it. */
  deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void>;
}
