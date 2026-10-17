import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import { spaces } from "@/modules/spaces/infrastructure/spaces.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// Money accounts of a space (spec 5.2). Better Auth's credential table is the singular "account".
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Same values as ACCOUNT_TYPES in the domain; listed here so drizzle-kit loads no domain code.
    type: text("type", {
      enum: [
        "CASH",
        "BANK",
        "WALLET",
        "CREDIT_CARD",
        "SAVINGS",
        "INVESTMENT",
        "LOAN",
        "OTHER",
        "SHARED_FUND",
      ],
    }).notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    openingBalance: bigint("opening_balance", { mode: "bigint" }).notNull(),
    archivedAt: tz("archived_at"),
    // HU-E2-05: optional common attributes; a null icon means the type's default (ruling P50).
    institution: text("institution"),
    lastFour: text("last_four"),
    color: text("color", {
      enum: ["pine", "ember", "sand", "sky", "plum", "moss", "clay", "slate", "gold", "rose"],
    }),
    icon: text("icon", {
      enum: [
        "banknote",
        "landmark",
        "wallet",
        "credit-card",
        "piggy-bank",
        "trending-up",
        "hand-coins",
        "circle-ellipsis",
        "users",
        "briefcase",
        "car",
        "gem",
        "gift",
        "house",
        "plane",
        "smartphone",
      ],
    }),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("accounts_space_name_uq").on(t.spaceId, sql`lower(${t.name})`),
    check("accounts_shared_fund_owner", sql`(${t.type} = 'SHARED_FUND') = (${t.ownerUserId} IS NULL)`),
    // HU-E2-05: only the last four digits, never a full card or account number.
    check("accounts_last_four", sql`${t.lastFour} ~ '^[0-9]{4}$'`),
  ],
);
