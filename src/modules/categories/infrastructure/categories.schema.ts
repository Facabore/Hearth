import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { spaces } from "@/modules/spaces/infrastructure/spaces.schema";
import { CATEGORY_COLORS } from "../domain/category-style";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const categoryGroups = pgTable(
  "category_groups",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // HU-E3-05, HU-E7-06: the catalog key of a seeded group (housing, food, ...); null for groups users create.
    key: text("key"),
    // HU-E3-05: a symbol's name or the emoji itself; the defaults are CUSTOM_GROUP_STYLE (ruling P56).
    iconKind: text("icon_kind", { enum: ["SYMBOL", "EMOJI"] })
      .notNull()
      .default("SYMBOL"),
    iconValue: text("icon_value").notNull().default("tag"),
    // D22: the palette keys live in TypeScript only (CATEGORY_COLORS), not in a database check (ruling P49).
    color: text("color", { enum: CATEGORY_COLORS }).notNull().default("GRAPHITE"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("category_groups_space_name_uq").on(t.spaceId, sql`lower(${t.name})`),
    // HU-E3-05: at most one group per catalog key and space; NULL keys (groups users create) never collide.
    uniqueIndex("category_groups_space_key_uq").on(t.spaceId, t.key),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    // Groups are never hard-deleted, so no cascade here.
    groupId: uuid("group_id")
      .notNull()
      .references(() => categoryGroups.id),
    // HU-E3-04: the category a subcategory refines; null for a category directly in its group.
    parentCategoryId: uuid("parent_category_id").references((): AnyPgColumn => categories.id),
    name: text("name").notNull(),
    key: text("key"),
    // HU-E3-05: a category's own style; none for a subcategory, which shows its parent's.
    iconKind: text("icon_kind", { enum: ["SYMBOL", "EMOJI"] }),
    iconValue: text("icon_value"),
    color: text("color", { enum: CATEGORY_COLORS }),
    archivedAt: tz("archived_at"),
    // D8 (Task 0a): deleting a category is logical; the row stays for the transactions that name it.
    deletedAt: tz("deleted_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    // HU-E3-02, HU-E3-04: unique among siblings ignoring case, rows not deleted (archived ones included; D8). Siblings
    // share a parent: the parent category of a subcategory, else the group (UUIDs never collide across the two).
    uniqueIndex("categories_parent_name_uq")
      .on(sql`coalesce(${t.parentCategoryId}, ${t.groupId})`, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    index("categories_parent_idx").on(t.parentCategoryId),
    check("categories_not_own_parent", sql`${t.parentCategoryId} <> ${t.id}`),
    // HU-E3-05: an icon and a color together; a category has its own, a subcategory none (ruling P57).
    check("categories_style_whole", sql`num_nulls(${t.iconKind}, ${t.iconValue}, ${t.color}) IN (0, 3)`),
    check("categories_style_by_level", sql`(${t.parentCategoryId} IS NULL) = (${t.color} IS NOT NULL)`),
    // HU-E3-01: seeding twice can never duplicate a catalog key; NULL keys (user categories) never collide.
    uniqueIndex("categories_space_key_uq").on(t.spaceId, t.key),
    index("categories_space_idx").on(t.spaceId),
  ],
);
