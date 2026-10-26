import type { LocalDate, StoredPeriod } from "@/shared/kernel";
import type { MemberCapacity } from "../domain/capacity";
import type { AllocationValue } from "../domain/allocation";
import type { AllocationRule, BudgetLine, BudgetLineId } from "../domain/budget-line";
import type { BudgetPlan, BudgetPlanId, PlanStatus } from "../domain/plan";
import type { PlanParts } from "../domain/plan-figures";

/** A plan's capacities, lines that are not deleted, current category mappings and current allocation values. */
export type PlanContents = PlanParts;

/** HU-E6-01: plans and the version lock every write to a plan takes (spec 7). */
export interface BudgetPlanRepository {
  /** Stores a new plan; false when the space already has a plan starting that day (a concurrent creation). */
  add(plan: BudgetPlan): Promise<boolean>;
  /** A plan of the space; null for unknown or malformed ids and for another space's plan. */
  find(spaceId: string, planId: string): Promise<BudgetPlan | null>;
  /** D10: the stored boundaries of the space's plans, oldest first; `[]` for malformed ids. */
  storedPeriods(spaceId: string): Promise<StoredPeriod[]>;
  /** D6, HU-E1-03: whether the space has a plan, whose amounts are in the space currency; false for malformed ids. */
  hasPlans(spaceId: string): Promise<boolean>;
  /**
   * Starts a write inside the caller's transaction: locks the plan row (FOR NO KEY UPDATE), bumps its version and
   * returns the new one. Writers of one plan queue here until the holder's transaction ends and then see its committed
   * work, so reads of the plan after this call are current and stay so. Null when the plan does not exist, when
   * `expectedVersion` is given and is not current (If-Match), or when the version changed between the check and the
   * bump (possible only outside a transaction, which holds no lock).
   */
  lockForWrite(planId: BudgetPlanId, expectedVersion: number | null, at: Date): Promise<number | null>;
  /**
   * HU-E6-06 … HU-E6-08: the space's plan whose stored period covers `date` (stored periods never overlap, D10);
   * null when none does and for malformed ids. With `share`, the row is locked FOR SHARE until the caller's
   * transaction ends: the read waits for a write to the plan in progress (FOR NO KEY UPDATE, `lockForWrite`) and
   * keeps new writes waiting until then, while other readers share it (ruling P14). A transaction that will write the
   * plan takes `lockForWrite` first: one that reads it with `share` and then calls `lockForWrite` on the same plan
   * deadlocks with another doing the same (a share lock cannot be upgraded).
   */
  covering(
    spaceId: string,
    date: LocalDate,
    options?: { readonly share?: boolean },
  ): Promise<BudgetPlan | null>;
  /** Capacities by member; lines that are not deleted in creation order; current mappings and values by line. */
  contents(planId: BudgetPlanId): Promise<PlanContents>;
  /**
   * Issues #158 and #183 (ruling P250): every plan of the space copied from `planId`, of any status, oldest first; `[]`
   * for malformed ids. Each row is locked FOR SHARE until the caller's transaction ends, so the read waits for a close
   * of a copy in progress (`lockForWrite`, FOR NO KEY UPDATE) and sees its committed status, and a close that starts
   * meanwhile waits for this transaction. Activation reads them, after locking the source, to refuse activating a
   * DRAFT source whose CLOSED copy carries from it. No deadlock: a close reads its source without a lock.
   */
  lockCopiesOf(spaceId: string, planId: string): Promise<BudgetPlan[]>;
}

/** Spec 5.4, D7: spending within dates, summed on read by the ledger and bound by the composition root. */
export interface PlanSpending {
  /** Σ live expenses of the space dated within [from, to] per category; categories without any are absent. */
  expensesByCategory(
    spaceId: string,
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ categoryId: string; amount: bigint }[]>;
  /** Σ live transfers dated within [from, to] into each of the accounts, whatever space recorded them. */
  transfersIntoAccounts(
    accountIds: readonly string[],
    from: LocalDate,
    to: LocalDate,
  ): Promise<{ accountId: string; amount: bigint }[]>;
}

/** HU-E6-02: capacities are edited in place; a member without one counts as 0. */
export interface CapacityRepository {
  /** Inserts or replaces the capacity of each listed member; members not listed keep theirs. */
  setCapacities(planId: BudgetPlanId, capacities: readonly MemberCapacity[], at: Date): Promise<void>;
}

/**
 * D17: the income `userId` recorded in their personal space dated within [from, to], in its currency; null when
 * the user has no personal space. Bound to the spaces and ledger modules; only the caller's income is asked for.
 */
export type PreviousIncome = (
  userId: string,
  from: LocalDate,
  to: LocalDate,
) => Promise<{ readonly amount: bigint; readonly currency: string } | null>;

/** HU-E6-03: lines are edited in place and removed logically (D8). */
export interface BudgetLineRepository {
  addLine(line: BudgetLine, at: Date): Promise<void>;
  /**
   * Persists the name, planned amount, funding, savings accounts, rollover mode and catch-all flag of a current line
   * of the line's own plan; a line of another plan or a removed one is not found and nothing is saved.
   */
  saveLine(line: BudgetLine, at: Date): Promise<void>;
  /** D8: sets deletedAt once and ends the line's current category mappings; its name and categories are free again. */
  deleteLine(planId: BudgetPlanId, lineId: BudgetLineId, at: Date): Promise<void>;
}

/** What budgeting needs to know about an account a SAVINGS line names; bound to the accounts module. */
export interface BudgetAccount {
  readonly id: string;
  readonly ownerUserId: string;
  readonly isSavings: boolean;
  readonly archived: boolean;
  /** D6: the currency of the space the account lives in; its movements are in it. */
  readonly currency: string;
}

export interface SavingsAccountReader {
  /**
   * Any account with an owner by id, whatever its space; null for unknown or malformed ids and for accounts nobody
   * owns (a shared fund), which a SAVINGS line never names.
   */
  find(accountId: string): Promise<BudgetAccount | null>;
}

/** HU-E6-04: a line's categories are replaced as a set; ended mappings keep their rows (D8). */
export interface CategoryMappingRepository {
  /**
   * Makes `categoryIds` the line's current categories: ends the others' mappings and maps the new ones. Only for a
   * current line of the plan; a line of another plan or a removed one is not found and nothing changes.
   */
  mapCategories(
    planId: BudgetPlanId,
    lineId: BudgetLineId,
    categoryIds: readonly string[],
    at: Date,
  ): Promise<void>;
  /** HU-E3-03: whether any plan maps or once mapped the category (ended mappings count, like deleted transactions). */
  isCategoryMapped(categoryId: string): Promise<boolean>;
}

/** The live categories of a space (deleted ones never appear, D8), archived ones flagged; bound to categories. */
export interface BudgetCategories {
  list(
    spaceId: string,
  ): Promise<
    { readonly id: string; readonly archived: boolean; readonly parentCategoryId?: string | null }[]
  >;
}

/** HU-E6-05: allocating a line sets its rule and supersedes its earlier member values; nothing is deleted (D8). */
export interface AllocationRepository {
  /**
   * Sets the rule of a current line of the plan, supersedes its current member values and stores `values`; a line of
   * another plan or a removed one is not found and nothing changes.
   */
  setAllocation(
    planId: BudgetPlanId,
    lineId: BudgetLineId,
    rule: AllocationRule,
    values: readonly AllocationValue[],
    at: Date,
  ): Promise<void>;
}

/** HU-E6-07: a plan's status changes only through its transitions, under the plan's version lock. */
export interface PlanStatusRepository {
  /** Sets the status and the update time; the version is the one `lockForWrite` already gave the plan. */
  setStatus(planId: BudgetPlanId, status: PlanStatus, at: Date): Promise<void>;
}
