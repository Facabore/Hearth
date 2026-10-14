import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "@/modules/accounts/infrastructure/accounts.schema";
import { categories } from "@/modules/categories/infrastructure/categories.schema";
import { spaceMembers, spaces } from "@/modules/spaces/infrastructure/spaces.schema";
import type { ChangeSet } from "../domain/transaction";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"] }).notNull(),
    description: text("description").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    sourceAccountId: uuid("source_account_id").references(() => accounts.id),
    destinationAccountId: uuid("destination_account_id").references(() => accounts.id),
    receivingMemberId: uuid("receiving_member_id").references(() => spaceMembers.id),
    // HU-E4-09: the contributor of a TRANSFER into the shared fund; HU-E5-02: the payer of a SETTLEMENT.
    payerMemberId: uuid("payer_member_id").references(() => spaceMembers.id),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
    deletedAt: tz("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    // The monthly view: one space, a date range, newest first (keyset on date, id).
    index("transactions_space_date_idx").on(t.spaceId, t.date, t.id),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_source_account_idx").on(t.sourceAccountId),
    index("transactions_destination_account_idx").on(t.destinationAccountId),
    index("transactions_payer_member_idx").on(t.payerMemberId),
    check("transactions_amount_positive", sql`${t.amount} > 0`),
    // A TRANSFER without a payer is between own accounts; with a payer it is a fund contribution, whose
    // source is null only for a guest (spec 5.2). A SETTLEMENT has both parties and optional accounts.
    check(
      "transactions_shape",
      sql`(${t.type} = 'EXPENSE' AND ${t.categoryId} IS NOT NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NULL AND ${t.receivingMemberId} IS NULL AND ${t.payerMemberId} IS NULL)
        OR (${t.type} = 'INCOME' AND ${t.categoryId} IS NOT NULL AND ${t.sourceAccountId} IS NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.receivingMemberId} IS NOT NULL AND ${t.payerMemberId} IS NULL)
        OR (${t.type} = 'TRANSFER' AND ${t.categoryId} IS NULL AND ${t.destinationAccountId} IS NOT NULL AND ${t.receivingMemberId} IS NULL AND (${t.sourceAccountId} IS NOT NULL OR ${t.payerMemberId} IS NOT NULL))
        OR (${t.type} = 'SETTLEMENT' AND ${t.categoryId} IS NULL AND ${t.payerMemberId} IS NOT NULL AND ${t.receivingMemberId} IS NOT NULL)`,
    ),
    // HU-E5-02: nobody settles with themselves.
    check(
      "transactions_settlement_parties",
      sql`${t.type} <> 'SETTLEMENT' OR ${t.payerMemberId} <> ${t.receivingMemberId}`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    memberId: uuid("member_id").references(() => spaceMembers.id),
    accountId: uuid("account_id").references(() => accounts.id),
    amount: money("amount").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.position] }),
    index("payments_account_idx").on(t.accountId),
    index("payments_member_idx").on(t.memberId),
    check("payments_amount_positive", sql`${t.amount} > 0`),
    // Spec 5.2: memberId is null only for fund payments, accountId only for guests, never both.
    check("payments_has_payer", sql`${t.memberId} IS NOT NULL OR ${t.accountId} IS NOT NULL`),
  ],
);

export const shares = pgTable(
  "shares",
  {
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => spaceMembers.id),
    amount: money("amount").notNull(),
    splitMethod: text("split_method", {
      enum: ["EQUAL", "PERCENT", "EXACT", "SHARES", "BY_ALLOCATION"],
    }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.position] }),
    index("shares_member_idx").on(t.memberId),
    check("shares_amount_positive", sql`${t.amount} > 0`),
  ],
);

export const transactionAudit = pgTable(
  "transaction_audit",
  {
    id: uuid("id").primaryKey(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    action: text("action", { enum: ["UPDATED", "DELETED"] }).notNull(),
    actorUserId: text("actor_user_id").notNull(),
    at: tz("at").notNull(),
    changes: jsonb("changes").$type<ChangeSet>().notNull(),
  },
  (t) => [index("transaction_audit_transaction_idx").on(t.transactionId, t.at)],
);
