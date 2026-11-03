import type { SpaceAccess, SpaceLocks, SpaceMemberRepository } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { BudgetCategories, BudgetPlanRepository, PlanSpending, SavingsAccountReader } from "./ports";

/** What every budgeting use case needs; the composition root binds each port (budgeting imports only spaces). */
export interface BudgetingDeps {
  readonly access: SpaceAccess;
  /**
   * Issue #245: a new plan reads the space's period policy and fixes its currency, so creating or copying one holds the
   * space row as a money write does (#89), and a settings change waits for it, or it for the change.
   */
  readonly spaceLocks: Pick<SpaceLocks, "lockForMoneyWrite">;
  /** Current members in join order, registered and guests (D15): capacities and allocations follow them. */
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly plans: BudgetPlanRepository;
  readonly spending: PlanSpending;
  /** The accounts SAVINGS lines name: lines attach only their caller's own, and figures count only current members'. */
  readonly savingsAccounts: SavingsAccountReader;
  /** HU-E3-04: the space's live categories with their parents, so subcategories roll up (D20). */
  readonly categories: BudgetCategories;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
