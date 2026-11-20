import { and, asc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
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

/**
 * P347: a category not deleted, or one deleted together with its group (the group's instant); with `categories` joined
 * to `category_groups`.
 */
const liveOrDeletedWithGroup = or(
  isNull(categories.deletedAt),
  eq(categories.deletedAt, categoryGroups.deletedAt),
);

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

  /** The same advisory key as `lockTree`, shared: it conflicts only with `lockTree`. */
  async lockTreeForReference(spaceId: string): Promise<void> {
    await this.tm
      .executor()
      .execute(
        sql`SELECT pg_advisory_xact_lock_shared(hashtextextended('categories:' || ${spaceId}::text, 0))`,
      );
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
          position: g.position,
          archivedAt: g.archivedAt,
          createdAt: g.createdAt,
        })),
      );
  }

  /**
   * Ruling P296: the positions of `groups`, all of `spaceId`. The unique place cannot be deferred, so the rows first
   * park past every position the space uses (dense from 0, so `position + count` is free), then each takes its own.
   */
  async saveGroupPositions(spaceId: string, groups: readonly CategoryGroup[]): Promise<void> {
    if (groups.length === 0) return;
    const db = this.tm.executor();
    const ids = groups.map((g) => g.id);
    await db
      .update(categoryGroups)
      .set({
        position: sql`${categoryGroups.position} + (SELECT count(*)::integer FROM ${categoryGroups} WHERE ${categoryGroups.spaceId} = ${spaceId})`,
      })
      .where(and(eq(categoryGroups.spaceId, spaceId), inArray(categoryGroups.id, ids)));
    for (const g of groups)
      await db
        .update(categoryGroups)
        .set({ position: g.position })
        .where(and(eq(categoryGroups.spaceId, spaceId), eq(categoryGroups.id, g.id)));
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
    // P347: a deleted group answers as missing, like a deleted category (D8).
    return this.groupsWhere(and(eq(categoryGroups.spaceId, spaceId), isNull(categoryGroups.deletedAt)));
  }

  async listDeletedGroups(spaceId: string): Promise<CategoryGroup[]> {
    return this.groupsWhere(and(eq(categoryGroups.spaceId, spaceId), isNotNull(categoryGroups.deletedAt)));
  }

  /** The groups `where` selects, by position; a live group carries no `deletedAt`. */
  private async groupsWhere(where: SQL | undefined): Promise<CategoryGroup[]> {
    const rows = await this.tm
      .executor()
      .select()
      .from(categoryGroups)
      .where(where)
      .orderBy(asc(categoryGroups.position));
    return rows.map(({ iconKind, iconValue, color, deletedAt, ...row }) => ({
      ...row,
      ...(deletedAt === null ? {} : { deletedAt }),
      id: row.id as CategoryGroupId,
      style: { icon: iconOf(iconKind, iconValue), color },
    }));
  }

  async listCategories(spaceId: string): Promise<Category[]> {
    // D8: deleted categories stay stored, but every read skips them, so they answer as missing.
    return this.categoriesWhere(and(eq(categories.spaceId, spaceId), isNull(categories.deletedAt)));
  }

  async listCategoriesForHistory(spaceId: string): Promise<Category[]> {
    // P347: a category deleted with its group took the group's very instant; one deleted on its own never did.
    return this.categoriesWhere(and(eq(categories.spaceId, spaceId), liveOrDeletedWithGroup));
  }

  /** The categories `where` selects, with the group each sits in joined; a live category carries no `deletedAt`. */
  private async categoriesWhere(where: SQL | undefined): Promise<Category[]> {
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
        deletedAt: categories.deletedAt,
        createdAt: categories.createdAt,
      })
      .from(categories)
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      .where(where);
    return rows.map(({ iconKind, iconValue, color, deletedAt, ...row }) => ({
      ...row,
      ...(deletedAt === null ? {} : { deletedAt }),
      id: row.id as CategoryId,
      groupId: row.groupId as CategoryGroupId,
      parentCategoryId: row.parentCategoryId as CategoryId | null,
      style: styleOfRow({ iconKind, iconValue, color }),
    }));
  }

  /**
   * HU-E7-06: the categories and subcategories of `spaceIds` not deleted (D8; archived ones included, HU-E3-03, and
   * P347, those deleted together with their group, archived like it), each
   * with the group it sits in now and both catalog keys, in one statement; sorted by space, then category; `[]`
   * without well-formed ids (these come from ledger rows, not from a resolved membership).
   */
  async treesOf(spaceIds: readonly string[]): Promise<
    {
      spaceId: string;
      groupId: string;
      groupKey: string | null;
      groupName: string;
      groupArchived: boolean;
      categoryId: string;
      categoryKey: string | null;
      categoryName: string;
      categoryArchived: boolean;
      parentCategoryId: string | null;
    }[]
  > {
    const ids = spaceIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({
        spaceId: categories.spaceId,
        groupId: categoryGroups.id,
        groupKey: categoryGroups.key,
        groupName: categoryGroups.name,
        groupArchivedAt: categoryGroups.archivedAt,
        categoryId: categories.id,
        categoryKey: categories.key,
        categoryName: categories.name,
        categoryArchivedAt: categories.archivedAt,
        parentCategoryId: categories.parentCategoryId,
      })
      .from(categories)
      .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
      // P347: the categories deleted with their group still name what was spent in them (archived, as the group is).
      .where(and(inArray(categories.spaceId, ids), liveOrDeletedWithGroup))
      .orderBy(asc(categories.spaceId), asc(categories.id));
    return rows.map(({ groupArchivedAt, categoryArchivedAt, ...row }) => ({
      ...row,
      groupArchived: groupArchivedAt !== null,
      categoryArchived: categoryArchivedAt !== null,
    }));
  }

  /**
   * HU-E7-06 (#130): the groups of `spaceIds`, archived ones included (P347: deleted ones too, archived as they are, so
   * a deleted group still names what was spent in it), whether or not they hold a live category,
   * sorted by space, then id; `[]` without well-formed ids.
   */
  async groupsOf(spaceIds: readonly string[]): Promise<
    {
      spaceId: string;
      groupId: string;
      groupKey: string | null;
      groupName: string;
      groupArchived: boolean;
    }[]
  > {
    const ids = spaceIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.tm
      .executor()
      .select({
        spaceId: categoryGroups.spaceId,
        groupId: categoryGroups.id,
        groupKey: categoryGroups.key,
        groupName: categoryGroups.name,
        groupArchivedAt: categoryGroups.archivedAt,
      })
      .from(categoryGroups)
      .where(inArray(categoryGroups.spaceId, ids))
      .orderBy(asc(categoryGroups.spaceId), asc(categoryGroups.id));
    return rows.map(({ groupArchivedAt, ...row }) => ({ ...row, groupArchived: groupArchivedAt !== null }));
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
        // D8: a deleted category is never written again, like every read skips it.
        .where(and(eq(categories.id, c.id), isNull(categories.deletedAt)));
    }
  }

  async deleteGroup(group: CategoryGroup, deleted: readonly Category[]): Promise<void> {
    const db = this.tm.executor();
    // D8: deleting twice keeps the first deletion's time, on the group and on each category alike.
    await db
      .update(categoryGroups)
      .set({ archivedAt: group.archivedAt, deletedAt: group.deletedAt ?? null })
      .where(
        and(
          eq(categoryGroups.spaceId, group.spaceId),
          eq(categoryGroups.id, group.id),
          isNull(categoryGroups.deletedAt),
        ),
      );
    for (const c of deleted)
      await db
        .update(categories)
        .set({ archivedAt: c.archivedAt, deletedAt: c.deletedAt ?? null })
        .where(and(eq(categories.spaceId, c.spaceId), eq(categories.id, c.id), isNull(categories.deletedAt)));
  }

  async deleteCategory(spaceId: string, categoryId: string, deletedAt: Date): Promise<void> {
    await this.tm
      .executor()
      .update(categories)
      .set({ deletedAt })
      // D8: deleting twice keeps the first deletion's time.
      .where(
        and(eq(categories.spaceId, spaceId), eq(categories.id, categoryId), isNull(categories.deletedAt)),
      );
  }
}
