import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "@/modules/identity/infrastructure/auth.schema";
import { spaces } from "@/modules/spaces/infrastructure/spaces.schema";
import { PALETTE } from "@/shared/kernel";
import { ACCOUNT_ICONS, ACCOUNT_TYPES } from "../domain/account";
import { MAX_BILLING_DAY, MAX_TERM_DAYS, MAX_TERM_MONTHS, MIN_BILLING_DAY } from "../domain/account-terms";
import { MAX_RATE_PPM } from "../domain/rate";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// A domain bound written into a CHECK: a literal, so `db:check` sees the same SQL whenever the constant moves.
const bound = (value: number) => sql.raw(String(value));

// Money accounts of a space (spec 5.2). Better Auth's credential table is the singular "account".
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id, { onDelete: "cascade" }),
    openingBalance: bigint("opening_balance", { mode: "bigint" }).notNull(),
    archivedAt: tz("archived_at"),
    // HU-E2-05: optional common attributes; a null icon means the type's default (ruling P50).
    institution: text("institution"),
    lastFour: text("last_four"),
    // Ruling P122: the app's palette keys and Hearth symbol names, from the same lists the domain and the contract use.
    color: text("color", { enum: PALETTE }),
    icon: text("icon", { enum: ACCOUNT_ICONS }),
    // HU-E2-07, ruling P51: null means the type's default; nothing is back-filled.
    includeInAvailable: boolean("include_in_available"),
    includeInNetWorth: boolean("include_in_net_worth"),
    // HU-E2-06, ruling P52: type-specific terms as typed columns; money in minor units, rates in parts per million.
    creditLimit: bigint("credit_limit", { mode: "bigint" }),
    cutOffDay: smallint("cut_off_day"),
    paymentDay: smallint("payment_day"),
    monthlyRatePpm: integer("monthly_rate_ppm"),
    annualRatePpm: integer("annual_rate_ppm"),
    termDays: smallint("term_days"),
    maturityDate: date("maturity_date", { mode: "string" }),
    principal: bigint("principal", { mode: "bigint" }),
    termMonths: smallint("term_months"),
    createdAt: tz("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("accounts_space_name_uq").on(t.spaceId, sql`lower(${t.name})`),
    check("accounts_shared_fund_owner", sql`(${t.type} = 'SHARED_FUND') = (${t.ownerUserId} IS NULL)`),
    // HU-E2-05: only the last four digits, never a full card or account number.
    check("accounts_last_four", sql`${t.lastFour} ~ '^[0-9]{4}$'`),
    // HU-E2-06: which type holds which term; the domain answers AccountAttributeNotAllowed first.
    check(
      "accounts_card_terms",
      sql`${t.type} = 'CREDIT_CARD' OR (${t.creditLimit} IS NULL AND ${t.cutOffDay} IS NULL AND ${t.paymentDay} IS NULL AND ${t.monthlyRatePpm} IS NULL)`,
    ),
    check("accounts_annual_rate", sql`${t.annualRatePpm} IS NULL OR ${t.type} IN ('SAVINGS', 'LOAN')`),
    check(
      "accounts_loan_terms",
      sql`${t.type} = 'LOAN' OR (${t.principal} IS NULL AND ${t.termMonths} IS NULL)`,
    ),
    check(
      "accounts_term_deposit",
      sql`(${t.termDays} IS NULL) = (${t.maturityDate} IS NULL) AND (${t.termDays} IS NULL OR ${t.type} = 'SAVINGS')`,
    ),
    // Every read dates the next billing days, and a day outside 1 to 31 makes that throw: keep them out of the table.
    check(
      "accounts_cut_off_day",
      sql`${t.cutOffDay} IS NULL OR ${t.cutOffDay} BETWEEN ${bound(MIN_BILLING_DAY)} AND ${bound(MAX_BILLING_DAY)}`,
    ),
    check(
      "accounts_payment_day",
      sql`${t.paymentDay} IS NULL OR ${t.paymentDay} BETWEEN ${bound(MIN_BILLING_DAY)} AND ${bound(MAX_BILLING_DAY)}`,
    ),
    // MAX_RATE_PPM is the domain's (100 %). The rate maths throws on a negative rate, so PostgreSQL refuses what a read
    // could not handle.
    check(
      "accounts_monthly_rate_range",
      sql`${t.monthlyRatePpm} IS NULL OR ${t.monthlyRatePpm} BETWEEN 0 AND ${bound(MAX_RATE_PPM)}`,
    ),
    check(
      "accounts_annual_rate_range",
      sql`${t.annualRatePpm} IS NULL OR ${t.annualRatePpm} BETWEEN 0 AND ${bound(MAX_RATE_PPM)}`,
    ),
    // The domain's own ranges (revisedTerms), which reviseAccount re-checks on every update, even a rename: a stored
    // term outside them would refuse every later change to the account.
    check(
      "accounts_term_days_range",
      sql`${t.termDays} IS NULL OR ${t.termDays} BETWEEN 1 AND ${bound(MAX_TERM_DAYS)}`,
    ),
    check(
      "accounts_term_months_range",
      sql`${t.termMonths} IS NULL OR ${t.termMonths} BETWEEN 1 AND ${bound(MAX_TERM_MONTHS)}`,
    ),
    check("accounts_credit_limit_positive", sql`${t.creditLimit} IS NULL OR ${t.creditLimit} > 0`),
    check("accounts_principal_positive", sql`${t.principal} IS NULL OR ${t.principal} > 0`),
  ],
);
