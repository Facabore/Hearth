import type { SpaceAccess, SpaceMemberRepository } from "@/modules/spaces/application";
import type { Clock, IdGenerator, TransactionManager } from "@/shared/kernel";
import type { BudgetPlanRepository, PlanSpending } from "./ports";

/** What every budgeting use case needs; the composition root binds each port (budgeting imports only spaces). */
export interface BudgetingDeps {
  readonly access: SpaceAccess;
  /** Current members in join order, registered and guests (D15): capacities and allocations follow them. */
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly plans: BudgetPlanRepository;
  readonly spending: PlanSpending;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly tm: TransactionManager;
}
