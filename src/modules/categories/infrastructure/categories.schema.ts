import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    name: text("name").notNull(),
    key: text("key"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    // HU-E3-02: unique per parent ignoring case (archived rows included).
    uniqueIndex("categories_group_name_uq").on(t.groupId, sql`lower(${t.name})`),
    // HU-E3-01: seeding twice can never duplicate a catalog key; NULL keys (user categories) never collide.
    uniqueIndex("categories_space_key_uq").on(t.spaceId, t.key),
    index("categories_space_idx").on(t.spaceId),
  ],
);
