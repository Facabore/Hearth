import { and, eq, isNull, sql } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import type { CategoryRepository } from "../application/category-repository";
import type { Category, CategoryGroup, CategoryGroupId, CategoryId } from "../domain/category";
import type { CategoryColor, CategoryIcon, CategoryStyle, CategorySymbol } from "../domain/category-style";
import { categories, categoryGroups } from "./categories.schema";

type IconKind = CategoryIcon["kind"];

/** HU-E3-05: an icon as its two columns; `icon_value` holds a symbol's name or the emoji itself. */
const iconColumns = (icon: CategoryIcon) => ({
  iconKind: icon.kind,
  iconValue: icon.kind === "SYMBOL" ? icon.name : icon.value,
});

const iconOf = (kind: IconKind, value: string): CategoryIcon =>
  kind === "SYMBOL" ? { kind, name: value as CategorySymbol } : { kind, value };

/** A category's own style as columns; a subcategory stores none (`categories_style_by_level`). */
const styleColumns = (style: CategoryStyle | null) =>
  style === null
    ? { iconKind: null, iconValue: null, color: null }
    : { ...iconColumns(style.icon), color: style.color };

const styleOfRow = (row: {
  iconKind: IconKind | null;
  iconValue: string | null;
  color: CategoryColor | null;
}): CategoryStyle | null =>
  row.iconKind === null || row.iconValue === null || row.color === null
    ? null
    : { icon: iconOf(row.iconKind, row.iconValue), color: row.color };

// Space ids always come from a resolved membership, so they are valid UUIDs here.
export class DrizzleCategoryRepository implements CategoryRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  /**
   * An advisory lock on the space's category tree, held until the caller's transaction ends. It is not a row lock on
   * `spaces`: this module does not reach into spaces, and FOR UPDATE there would conflict with the key-share locks that
   * foreign keys take on the space row.
   */
  async lockTree(spaceId: string): Promise<void> {
    await this.tm
      .executor()
      .execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('categories:' || ${spaceId}::text, 0))`);
  }

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
          key: g.key,
          ...iconColumns(g.style.icon),
          color: g.style.color,
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
          parentCategoryId: c.parentCategoryId,
          name: c.name,
          key: c.key,
          ...styleColumns(c.style),
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
    return rows.map(({ iconKind, iconValue, color, ...row }) => ({
      ...row,
      id: row.id as CategoryGroupId,
      style: { icon: iconOf(iconKind, iconValue), color },
    }));
  }

  async listCategories(spaceId: string): Promise<Category[]> {
    // D8 (Task 0a): deleted categories stay stored, but every read skips them, so they answer as missing.
    const rows = await this.tm
      .executor()
      .select({
        id: categories.id,
        spaceId: categories.spaceId,
        groupId: categories.groupId,
        parentCategoryId: categories.parentCategoryId,
        name: categories.name,
        key: categories.key,
        iconKind: categories.iconKind,
        iconValue: categories.iconValue,
        color: categories.color,
        archivedAt: categories.archivedAt,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .where(and(eq(categories.spaceId, spaceId), isNull(categories.deletedAt)));
    return rows.map(({ iconKind, iconValue, color, ...row }) => ({
      ...row,
      id: row.id as CategoryId,
      groupId: row.groupId as CategoryGroupId,
      parentCategoryId: row.parentCategoryId as CategoryId | null,
      style: styleOfRow({ iconKind, iconValue, color }),
    }));
  }

  async saveGroup(group: CategoryGroup): Promise<void> {
    await this.tm
      .executor()
      .update(categoryGroups)
      .set({
        // HU-E3-05: the catalog key is set when the group is added and never rewritten.
        name: group.name,
        ...iconColumns(group.style.icon),
        color: group.style.color,
        archivedAt: group.archivedAt,
      })
      .where(eq(categoryGroups.id, group.id));
  }

  async saveCategories(rows: readonly Category[]): Promise<void> {
    const db = this.tm.executor();
    for (const c of rows) {
      // HU-E3-05: the level and the style change in one statement, so categories_style_by_level always holds.
      await db
        .update(categories)
        .set({
          name: c.name,
          groupId: c.groupId,
          parentCategoryId: c.parentCategoryId,
          ...styleColumns(c.style),
          archivedAt: c.archivedAt,
        })
        .where(eq(categories.id, c.id));
    }
  }

  async deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void> {
    await this.tm
      .executor()
      .update(categories)
      .set({ deletedAt })
      .where(and(eq(categories.spaceId, spaceId), eq(categories.id, categoryId)));
  }
}
