import type { Category, CategoryGroup, CategoryRepository } from "@/modules/categories/application";

export class InMemoryCategories implements CategoryRepository {
  groups: CategoryGroup[] = [];
  categories: Category[] = [];

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
    return this.categories.filter((c) => c.spaceId === spaceId);
  }
  async saveGroup(group: CategoryGroup) {
    this.groups = this.groups.map((g) => (g.id === group.id ? group : g));
  }
  async saveCategories(changed: readonly Category[]) {
    this.categories = this.categories.map((c) => changed.find((x) => x.id === c.id) ?? c);
  }
  async deleteCategory(spaceId: string, categoryId: string) {
    this.categories = this.categories.filter((c) => !(c.spaceId === spaceId && c.id === categoryId));
  }
}
