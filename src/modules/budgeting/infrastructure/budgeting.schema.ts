import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { categories } from "@/modules/categories/infrastructure/categories.schema";
import { spaceMembers, spaces } from "@/modules/spaces/infrastructure/spaces.schema";

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

// Spec 5.2, HU-E6-01 … HU-E6-05. Values mirror the domain types; listed here so drizzle-kit loads no domain code.
// Every delete is logical (D8): no foreign key cascades, so no plan part can disappear with a parent row.
export const budgetPlans = pgTable(
  "budget_plans",
  {
    id: uuid("id").primaryKey(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id),
    // D10: the period is stored when the plan is created, so a later policy change never moves it.
    label: text("label").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status", { enum: ["DRAFT", "ACTIVE", "CLOSED"] }).notNull(),
    // HU-E6-06: the plan this one was copied from.
    createdFromPlanId: uuid("created_from_plan_id").references((): AnyPgColumn => budgetPlans.id),
    // The ETag; every write to the plan or its parts bumps it under a row lock (spec 7).
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    // HU-E6-01: one plan per period; stored periods never overlap (D10).
    uniqueIndex("budget_plans_space_start_uq").on(t.spaceId, t.startDate),
    index("budget_plans_created_from_idx").on(t.createdFromPlanId),
    check("budget_plans_dates", sql`${t.startDate} <= ${t.endDate}`),
  ],
);

export const budgetMemberCapacities = pgTable(
  "budget_member_capacities",
  {
    planId: uuid("plan_id")
      .notNull()
      .references(() => budgetPlans.id),
    // D15: capacities point to a SpaceMember, registered or guest; members are never deleted.
    memberId: uuid("member_id")
      .notNull()
      .references(() => spaceMembers.id),
    amount: money("amount").notNull(),
    updatedAt: tz("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.memberId] }),
    index("budget_member_capacities_member_idx").on(t.memberId),
    check("budget_member_capacities_amount", sql`${t.amount} >= 0`),
  ],
);

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => budgetPlans.id),
    // HU-E6-06, HU-E6-09: the line this one was copied from, for rollover.
    originLineId: uuid("origin_line_id").references((): AnyPgColumn => budgetLines.id),
    name: text("name").notNull(),
    plannedAmount: money("planned_amount").notNull(),
    funding: text("funding", { enum: ["DIRECT", "SHARED_FUND", "SAVINGS"] }).notNull(),
    // Spec 5.4: a SAVINGS line spends the transfers into these accounts (accounts are never deleted, D8).
    savingsAccountIds: uuid("savings_account_ids").array().notNull(),
    rolloverMode: text("rollover_mode", { enum: ["RESET", "ROLLOVER", "ADJUSTED"] }).notNull(),
    isCatchAll: boolean("is_catch_all").notNull(),
    // HU-E6-05: one rule per line; PERCENT and FIXED keep their member values in budget_allocations.
    allocationRule: text("allocation_rule", { enum: ["PROPORTIONAL", "PERCENT", "FIXED", "NONE"] }).notNull(),
    createdAt: tz("created_at").notNull(),
    updatedAt: tz("updated_at").notNull(),
    // D8: removing a line is logical; the row stays and every read skips it.
    deletedAt: tz("deleted_at"),
  },
  (t) => [
    index("budget_lines_plan_idx").on(t.planId),
    index("budget_lines_origin_idx").on(t.originLineId),
    // HU-E6-03: names are unique per plan ignoring case, among lines that are not deleted.
    uniqueIndex("budget_lines_plan_name_uq")
      .on(t.planId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    // HU-E6-04: at most one catch-all line per plan.
    uniqueIndex("budget_lines_catch_all_uq")
      .on(t.planId)
      .where(sql`${t.isCatchAll} AND ${t.deletedAt} IS NULL`),
    check("budget_lines_planned_positive", sql`${t.plannedAmount} > 0`),
    // HU-E6-03: SAVINGS lines, and only they, name savings accounts.
    check(
      "budget_lines_savings_accounts",
      sql`(${t.funding} = 'SAVINGS') = (cardinality(${t.savingsAccountIds}) > 0)`,
    ),
    // Spec 5.4: a SAVINGS line consumes transfers, never the unmapped categories.
    check("budget_lines_savings_catch_all", sql`NOT (${t.funding} = 'SAVINGS' AND ${t.isCatchAll})`),
  ],
);

export const budgetLineCategories = pgTable(
  "budget_line_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Copied from the line, so one partial index keeps a category on one current line per plan.
    planId: uuid("plan_id")
      .notNull()
      .references(() => budgetPlans.id),
    lineId: uuid("line_id")
      .notNull()
      .references(() => budgetLines.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    mappedAt: tz("mapped_at").notNull(),
    // D8: replacing a line's categories or removing the line ends a mapping; the row stays.
    unmappedAt: tz("unmapped_at"),
  },
  (t) => [
    // HU-E6-04: a category maps to at most one current line per plan.
    uniqueIndex("budget_line_categories_current_uq")
      .on(t.planId, t.categoryId)
      .where(sql`${t.unmappedAt} IS NULL`),
    index("budget_line_categories_line_idx").on(t.lineId),
    // HU-E3-03: deleting a category checks whether any plan maps or mapped it.
    index("budget_line_categories_category_idx").on(t.categoryId),
  ],
);

export const budgetAllocations = pgTable(
  "budget_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lineId: uuid("line_id")
      .notNull()
      .references(() => budgetLines.id),
    // D15: allocations point to a SpaceMember, registered or guest.
    memberId: uuid("member_id")
      .notNull()
      .references(() => spaceMembers.id),
    rule: text("rule", { enum: ["PERCENT", "FIXED"] }).notNull(),
    // PERCENT: basis points (42 % = 4200); FIXED: minor units of the space currency.
    value: money("value").notNull(),
    setAt: tz("set_at").notNull(),
    // D8: allocating the line again supersedes these values; the rows stay.
    supersededAt: tz("superseded_at"),
  },
  (t) => [
    // HU-E6-05: one current value per member of a line.
    uniqueIndex("budget_allocations_current_uq")
      .on(t.lineId, t.memberId)
      .where(sql`${t.supersededAt} IS NULL`),
    index("budget_allocations_member_idx").on(t.memberId),
    check("budget_allocations_value_positive", sql`${t.value} > 0`),
  ],
);
