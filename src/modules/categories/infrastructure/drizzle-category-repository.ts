import { and, eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { CategoryRepository } from "../application/category-repository";
import type { Category, CategoryGroup, CategoryGroupId, CategoryId } from "../domain/category";
import { categories, categoryGroups } from "./categories.schema";

// Space ids always come from a resolved membership, so they are valid UUIDs here.
export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async hasAny(spaceId: string): Promise<boolean> {
    const rows = await this.tm
      .executor()
      .select({ id: categoryGroups.id })
      .from(categoryGroups)
      .where(eq(categoryGroups.spaceId, spaceId))
      .limit(1);
    return rows.length > 0;
  }

  async addGroups(groups: readonly CategoryGroup[]): Promise<void> {
    if (groups.length === 0) return;
    await this.tm
      .executor()
      .insert(categoryGroups)
      .values(
        groups.map((g) => ({
          id: g.id,
          spaceId: g.spaceId,
          name: g.name,
          archivedAt: g.archivedAt,
          createdAt: g.createdAt,
        })),
      );
  }

  async addCategories(rows: readonly Category[]): Promise<void> {
    if (rows.length === 0) return;
    await this.tm
      .executor()
      .insert(categories)
      .values(
        rows.map((c) => ({
          id: c.id,
          spaceId: c.spaceId,
          groupId: c.groupId,
          name: c.name,
          key: c.key,
          archivedAt: c.archivedAt,
          createdAt: c.createdAt,
        })),
      );
  }

  async listGroups(spaceId: string): Promise<CategoryGroup[]> {
    const rows = await this.tm
      .executor()
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.spaceId, spaceId));
    return rows.map((row) => ({ ...row, id: row.id as CategoryGroupId }));
  }

  async listCategories(spaceId: string): Promise<Category[]> {
    const rows = await this.tm.executor().select().from(categories).where(eq(categories.spaceId, spaceId));
    return rows.map((row) => ({ ...row, id: row.id as CategoryId, groupId: row.groupId as CategoryGroupId }));
  }

  async saveGroup(group: CategoryGroup): Promise<void> {
    await this.tm
      .executor()
      .update(categoryGroups)
      .set({ name: group.name, archivedAt: group.archivedAt })
      .where(eq(categoryGroups.id, group.id));
  }

  async saveCategories(rows: readonly Category[]): Promise<void> {
    const db = this.tm.executor();
    for (const c of rows) {
      await db
        .update(categories)
        .set({ name: c.name, groupId: c.groupId, archivedAt: c.archivedAt })
        .where(eq(categories.id, c.id));
    }
  }

  async deleteCategory(spaceId: string, categoryId: string): Promise<void> {
    await this.tm
      .executor()
      .delete(categories)
      .where(and(eq(categories.spaceId, spaceId), eq(categories.id, categoryId)));
  }
}
