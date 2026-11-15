import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** D27: each person's one referral code, created the first time it is read. */
export const referralCodes = pgTable("referral_codes", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  createdAt: tz("created_at").notNull(),
});

/**
 * D27: who referred whom. The referred account is the key, so it has one referrer at most; points are counted from
 * these rows on read (D7), never stored.
 */
export const referrals = pgTable(
  "referrals",
  {
    referredUserId: text("referred_user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    referrerUserId: text("referrer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    index("referrals_referrer_idx").on(t.referrerUserId),
    check("referrals_not_self", sql`${t.referredUserId} <> ${t.referrerUserId}`),
  ],
);
