import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { DATE_FORMATS, NUMBER_FORMATS, TIME_FORMATS, WEEK_STARTS } from "../domain/preferences";

// Property names are the field names Better Auth expects; column names are snake_case.
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    locale: text("locale").notNull().default("es"),
    timezone: text("timezone").notNull().default("America/Bogota"),
    // HU-E1-15, D23: null follows the installation rule; Better Auth never reads or writes these four.
    numberFormat: text("number_format", { enum: NUMBER_FORMATS }),
    timeFormat: text("time_format", { enum: TIME_FORMATS }),
    dateFormat: text("date_format", { enum: DATE_FORMATS }),
    weekStart: text("week_start", { enum: WEEK_STARTS }),
    // D29, slice MC4: the ISO 4217 currency of this person's totals and unified view; null means "my personal space's
    // currency". An open set (any circulating code), so no check constraint; the use case refuses unknown codes.
    displayCurrency: text("display_currency"),
    // Ruling P339: the person's @usuario, stored in lower case; null until they pick one. Better Auth never reads it.
    handle: text("handle"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("user_number_format", sql`${t.numberFormat} IN ('DOT_COMMA', 'COMMA_DOT', 'SPACE_COMMA')`),
    check("user_time_format", sql`${t.timeFormat} IN ('H24', 'H12')`),
    check("user_date_format", sql`${t.dateFormat} IN ('DMY', 'MDY', 'YMD')`),
    check("user_week_start", sql`${t.weekStart} IN ('MONDAY', 'SUNDAY')`),
    // Ruling P339: unique ignoring case; the database decides two people picking the same handle at once.
    uniqueIndex("user_handle_uq").on(sql`lower(${t.handle})`),
    check("user_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,20}$'`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
