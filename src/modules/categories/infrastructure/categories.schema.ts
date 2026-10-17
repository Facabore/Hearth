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

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const categoryGroups = pgTable(
  "category_groups",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [uniqueIndex("category_groups_space_name_uq").on(t.spaceId, sql`lower(${t.name})`)],
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
    // HU-E3-01: seeding twice can never duplicate a catalog key; NULL keys (user categories) never collide.
    uniqueIndex("categories_space_key_uq").on(t.spaceId, t.key),
    index("categories_space_idx").on(t.spaceId),
  ],
);
