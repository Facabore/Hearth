import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "@/modules/accounts/infrastructure/accounts.schema";
import { categories } from "@/modules/categories/infrastructure/categories.schema";
import { spaceMembers, spaces } from "@/modules/spaces/infrastructure/spaces.schema";
import type { PeriodPolicy } from "@/shared/kernel";
import type { RecurrenceSplit } from "../domain/recurrence";
import { transactions } from "./ledger.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

export const recurrences = pgTable(
  "recurrences",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    type: text("type", { enum: ["EXPENSE", "INCOME", "TRANSFER", "FUND_CONTRIBUTION"] }).notNull(),
    description: text("description").notNull(),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    // The template's references, as on transactions (spec 5.2; ruling P22).
    categoryId: uuid("category_id").references(() => categories.id),
    payerMemberId: uuid("payer_member_id").references(() => spaceMembers.id),
    sourceAccountId: uuid("source_account_id").references(() => accounts.id),
    destinationAccountId: uuid("destination_account_id").references(() => accounts.id),
    // Ratios only (ruling P23); null: the default split of each occurrence.
    split: jsonb("split").$type<RecurrenceSplit>(),
    schedule: jsonb("schedule").$type<PeriodPolicy>().notNull(),
    mode: text("mode", { enum: ["AUTO", "CONFIRM"] }).notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    // The first date the scheduler has not considered yet (ruling P24).
    dueFrom: date("due_from", { mode: "string" }).notNull(),
    pausedAt: tz("paused_at"),
    pauseReason: text("pause_reason"),
    endedAt: tz("ended_at"),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    index("recurrences_space_idx").on(t.spaceId, t.createdAt),
    // The scheduler's question (ruling P20): which recurrences still run.
    index("recurrences_active_idx")
      .on(t.dueFrom)
      .where(sql`${t.pausedAt} IS NULL AND ${t.endedAt} IS NULL`),
    check("recurrences_amount_positive", sql`${t.amount} > 0`),
    check("recurrences_dates", sql`${t.endDate} IS NULL OR ${t.endDate} >= ${t.startDate}`),
    // As transactions_shape: an expense is paid by a member (with an account unless a guest) or by the fund; an
    // income lands in an account; a transfer moves between two; a contribution goes from a member into the fund.
    check(
      "recurrences_shape",
      sql`(${t.type} = 'EXPENSE' AND ${t.categoryId} IS NOT NULL AND ${t.destinationAccountId} IS NULL AND (${t.payerMemberId} IS NOT NULL OR ${t.sourceAccountId} IS NOT NULL))
        OR (${t.type} = 'INCOME' AND ${t.categoryId} IS NOT NULL AND ${t.payerMemberId} IS NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.split} IS NULL)
        OR (${t.type} = 'TRANSFER' AND ${t.categoryId} IS NULL AND ${t.payerMemberId} IS NULL AND ${t.sourceAccountId} IS NOT NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.split} IS NULL)
        OR (${t.type} = 'FUND_CONTRIBUTION' AND ${t.categoryId} IS NULL AND ${t.payerMemberId} IS NOT NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.split} IS NULL)`,
    ),
  ],
);

export const recurrenceOccurrences = pgTable(
  "recurrence_occurrences",
  {
    id: uuid("id").primaryKey(),
    recurrenceId: uuid("recurrence_id")
      .notNull()
      .references(() => recurrences.id),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    occurrenceDate: date("occurrence_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["RECORDED", "PENDING", "SKIPPED"] }).notNull(),
    amount: money("amount").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id),
    reason: text("reason"),
    resolvedBy: text("resolved_by"),
    createdAt: tz("created_at").notNull(),
    resolvedAt: tz("resolved_at"),
  },
  (t) => [
    // Spec 5.2, HU-E4-12: one occurrence per recurrence and date, whatever races (ruling P20).
    uniqueIndex("recurrence_occurrences_date_uq").on(t.recurrenceId, t.occurrenceDate),
    uniqueIndex("recurrence_occurrences_transaction_uq").on(t.transactionId),
    index("recurrence_occurrences_pending_idx")
      .on(t.spaceId, t.occurrenceDate)
      .where(sql`${t.status} = 'PENDING'`),
    check("recurrence_occurrences_amount_positive", sql`${t.amount} > 0`),
    check(
      "recurrence_occurrences_recorded",
      sql`(${t.status} = 'RECORDED') = (${t.transactionId} IS NOT NULL)`,
    ),
  ],
);
