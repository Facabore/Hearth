import type { Category, CategoryGroup, CategoryRepository } from "@/modules/categories/application";

export class InMemoryCategories implements CategoryRepository {
  groups: CategoryGroup[] = [];
  categories: Category[] = [];
  /** D8 (Task 0a): when each deleted category was deleted; the rows stay, and lists skip them. */
  readonly deleted = new Map<string, Date>();

  async hasAny(spaceId: string) {
    return this.groups.some((g) => g.spaceId === spaceId);
  }
  async addGroups(groups: readonly CategoryGroup[]) {
    this.groups.push(...groups);
  }
  async addCategories(categories: readonly Category[]) {
    this.categories.push(...categories);
  }
  async listGroups(spaceId: string) {
    return this.groups.filter((g) => g.spaceId === spaceId);
  }
  async listCategories(spaceId: string) {
    return this.categories.filter((c) => c.spaceId === spaceId && !this.deleted.has(c.id));
  }
  async saveGroup(group: CategoryGroup) {
    this.groups = this.groups.map((g) => (g.id === group.id ? group : g));
  }
  async saveCategories(changed: readonly Category[]) {
    this.categories = this.categories.map((c) => changed.find((x) => x.id === c.id) ?? c);
  }
  async deleteCategory(spaceId: string, categoryId: string, deletedAt: Date) {
    if (this.categories.some((c) => c.spaceId === spaceId && c.id === categoryId)) {
      this.deleted.set(categoryId, deletedAt);
    }
  }
}
