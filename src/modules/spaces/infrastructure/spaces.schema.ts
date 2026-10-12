import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import type { PeriodPolicy } from "@/shared/kernel";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["PERSONAL", "SHARED", "DIRECT"] }).notNull(),
    currency: text("currency").notNull(),
    periodPolicy: jsonb("period_policy").$type<PeriodPolicy>().notNull(),
    personalOwnerUserId: text("personal_owner_user_id")
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    check("spaces_personal_owner", sql`(${t.kind} = 'PERSONAL') = (${t.personalOwnerUserId} IS NOT NULL)`),
  ],
);

export const spaceMembers = pgTable(
  "space_members",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["USER", "GUEST"] }).notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["OWNER", "ADMIN", "MEMBER", "VIEWER"] }),
    joinedAt: tz("joined_at").notNull(),
    leftAt: tz("left_at"),
    claimedAt: tz("claimed_at"),
  },
  (t) => [
    unique("space_members_space_user").on(t.spaceId, t.userId),
    index("space_members_user_id_idx").on(t.userId),
  ],
);
