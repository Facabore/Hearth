import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate, type StoredPeriod } from "@/shared/kernel";
import type { BudgetPlanRepository, PlanContents } from "../application/ports";
import type { BudgetLine, BudgetLineId } from "../domain/budget-line";
import type { MemberCapacity } from "../domain/capacity";
import type { BudgetPlan, BudgetPlanId } from "../domain/plan";
import {
  budgetAllocations,
  budgetLineCategories,
  budgetLines,
  budgetMemberCapacities,
  budgetPlans,
} from "./budgeting.schema";

const toPlan = (row: typeof budgetPlans.$inferSelect): BudgetPlan => ({
  id: row.id as BudgetPlanId,
  spaceId: row.spaceId,
  period: { label: row.label, start: row.startDate as LocalDate, end: row.endDate as LocalDate },
  status: row.status,
  createdFrom: row.createdFromPlanId as BudgetPlanId | null,
  version: row.version,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
});

const toLine = (row: typeof budgetLines.$inferSelect): BudgetLine => ({
  id: row.id as BudgetLineId,
  planId: row.planId,
  originLineId: row.originLineId,
  name: row.name,
  plannedAmount: row.plannedAmount,
  funding: row.funding,
  savingsAccountIds: row.savingsAccountIds,
  rolloverMode: row.rolloverMode,
  isCatchAll: row.isCatchAll,
  allocationRule: row.allocationRule,
  createdAt: row.createdAt,
});

/** The columns a request may change on a line; the allocation rule changes only with its allocation. */
const lineColumns = (line: BudgetLine) => ({
  name: line.name,
  plannedAmount: line.plannedAmount,
  funding: line.funding,
  savingsAccountIds: [...line.savingsAccountIds],
  rolloverMode: line.rolloverMode,
  isCatchAll: line.isCatchAll,
});

/** Plans and their parts (D7: figures are derived on read; D8: nothing is deleted). */
export class DrizzleBudgetPlanRepository implements BudgetPlanRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(plan: BudgetPlan): Promise<boolean> {
    const inserted = await this.tm
      .executor()
      .insert(budgetPlans)
      .values({
        id: plan.id,
        spaceId: plan.spaceId,
        label: plan.period.label,
        startDate: plan.period.start,
        endDate: plan.period.end,
        status: plan.status,
        createdFromPlanId: plan.createdFrom,
        version: plan.version,
        createdBy: plan.createdBy,
        createdAt: plan.createdAt,
        updatedAt: plan.createdAt,
      })
      // HU-E6-01: a concurrent creation of the same period stores nothing; the caller answers PlanAlreadyExists.
      .onConflictDoNothing({ target: [budgetPlans.spaceId, budgetPlans.startDate] })
      .returning({ id: budgetPlans.id });
    return inserted.length > 0;
  }

  async find(spaceId: string, planId: string): Promise<BudgetPlan | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId) || !isUuid(planId)) return null;
    const [row] = await this.tm
      .executor()
      .select()
      .from(budgetPlans)
      .where(and(eq(budgetPlans.id, planId), eq(budgetPlans.spaceId, spaceId)))
      .limit(1);
    return row ? toPlan(row) : null;
  }

  async storedPeriods(spaceId: string): Promise<StoredPeriod[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select({ label: budgetPlans.label, start: budgetPlans.startDate, end: budgetPlans.endDate })
      .from(budgetPlans)
      .where(eq(budgetPlans.spaceId, spaceId))
      .orderBy(asc(budgetPlans.startDate));
    return rows.map((r) => ({ label: r.label, start: r.start as LocalDate, end: r.end as LocalDate }));
  }

  async hasPlans(spaceId: string): Promise<boolean> {
    if (!isUuid(spaceId)) return false;
    const rows = await this.tm
      .executor()
      .select({ id: budgetPlans.id })
      .from(budgetPlans)
      .where(eq(budgetPlans.spaceId, spaceId))
      .limit(1);
    return rows.length > 0;
  }

  async lockForWrite(planId: BudgetPlanId, expectedVersion: number | null, at: Date): Promise<number | null> {
    const db = this.tm.executor();
    // The lock is held until the caller's transaction ends: a concurrent writer of this plan waits here and then reads
    // the version the holder committed, so its If-Match is checked against current data. NO KEY UPDATE conflicts with
    // other writers but not with the KEY SHARE locks that foreign keys take, so rows that reference the plan (a plan
    // copied from it, its lines) can still be inserted meanwhile.
    const [locked] = await db
      .select({ version: budgetPlans.version })
      .from(budgetPlans)
      .where(eq(budgetPlans.id, planId))
      .for("no key update");
    if (!locked || (expectedVersion !== null && locked.version !== expectedVersion)) return null;
    // Guarded by the version just compared (the If-Match version when one was sent), so compare-and-bump is one atomic
    // statement even when no transaction holds the lock.
    const [bumped] = await db
      .update(budgetPlans)
      .set({ version: sql`${budgetPlans.version} + 1`, updatedAt: at })
      .where(and(eq(budgetPlans.id, planId), eq(budgetPlans.version, locked.version)))
      .returning({ version: budgetPlans.version });
    return bumped?.version ?? null;
  }

  async contents(planId: BudgetPlanId): Promise<PlanContents> {
    const db = this.tm.executor();
    const capacities = await db
      .select({ memberId: budgetMemberCapacities.memberId, amount: budgetMemberCapacities.amount })
      .from(budgetMemberCapacities)
      .where(eq(budgetMemberCapacities.planId, planId))
      .orderBy(asc(budgetMemberCapacities.memberId));
    const lineRows = await db
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.planId, planId), isNull(budgetLines.deletedAt)))
      .orderBy(asc(budgetLines.createdAt), asc(budgetLines.id));
    const mappings = await db
      .select({ lineId: budgetLineCategories.lineId, categoryId: budgetLineCategories.categoryId })
      .from(budgetLineCategories)
      .where(and(eq(budgetLineCategories.planId, planId), isNull(budgetLineCategories.unmappedAt)))
      .orderBy(asc(budgetLineCategories.lineId), asc(budgetLineCategories.categoryId));
    const lineIds = lineRows.map((row) => row.id);
    const allocations =
      lineIds.length === 0
        ? []
        : await db
            .select({
              lineId: budgetAllocations.lineId,
              memberId: budgetAllocations.memberId,
              value: budgetAllocations.value,
            })
            .from(budgetAllocations)
            .where(and(inArray(budgetAllocations.lineId, lineIds), isNull(budgetAllocations.supersededAt)))
            .orderBy(asc(budgetAllocations.lineId), asc(budgetAllocations.memberId));
    return { capacities, lines: lineRows.map(toLine), mappings, allocations };
  }

  async setCapacities(planId: BudgetPlanId, capacities: readonly MemberCapacity[], at: Date): Promise<void> {
    if (capacities.length === 0) return;
    await this.tm
      .executor()
      .insert(budgetMemberCapacities)
      .values(capacities.map((c) => ({ planId, memberId: c.memberId, amount: c.amount, updatedAt: at })))
      // HU-E6-02: an edit, not a delete: the member's row keeps its key and takes the new amount.
      .onConflictDoUpdate({
        target: [budgetMemberCapacities.planId, budgetMemberCapacities.memberId],
        set: { amount: sql`excluded.amount`, updatedAt: sql`excluded.updated_at` },
      });
  }

  async addLine(line: BudgetLine, at: Date): Promise<void> {
    await this.tm
      .executor()
      .insert(budgetLines)
      .values({
        ...lineColumns(line),
        id: line.id,
        planId: line.planId,
        originLineId: line.originLineId,
        allocationRule: line.allocationRule,
        createdAt: line.createdAt,
        updatedAt: at,
      });
  }

  async saveLine(line: BudgetLine, at: Date): Promise<void> {
    await this.tm
      .executor()
      .update(budgetLines)
      .set({ ...lineColumns(line), updatedAt: at })
      // A line of another plan, or a removed one, is not found: nothing is saved.
      .where(
        and(eq(budgetLines.id, line.id), eq(budgetLines.planId, line.planId), isNull(budgetLines.deletedAt)),
      );
  }

  async deleteLine(planId: BudgetPlanId, lineId: BudgetLineId, at: Date): Promise<void> {
    const db = this.tm.executor();
    // D8: the row stays; the partial unique indexes free its name, its catch-all flag and its categories.
    await db
      .update(budgetLines)
      .set({ deletedAt: at, updatedAt: at })
      .where(and(eq(budgetLines.id, lineId), eq(budgetLines.planId, planId), isNull(budgetLines.deletedAt)));
    await db
      .update(budgetLineCategories)
      .set({ unmappedAt: at })
      .where(
        and(
          eq(budgetLineCategories.planId, planId),
          eq(budgetLineCategories.lineId, lineId),
          isNull(budgetLineCategories.unmappedAt),
        ),
      );
  }
}
