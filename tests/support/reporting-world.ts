import type {
  BudgetPlan,
  BudgetPlanId,
  PlanContents,
  PlanSpending,
  PlanStatus,
} from "@/modules/budgeting/application";
import type { ReportingDeps } from "@/modules/reporting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { periodByLabel, type LocalDate, type PeriodPolicy } from "@/shared/kernel";
import { budgetingWorld, HOUSEHOLD, NOW, savingsAccounts } from "./budgeting-world";
import { unwrap } from "./fakes";

/** PlanSpending of each period, keyed by the first day the ledger is asked for, as it sums them on read (D7). */
export class SpendingByPeriod implements PlanSpending {
  readonly expenses: Record<string, { categoryId: string; amount: bigint }[]> = {};
  readonly transfers: Record<string, { accountId: string; amount: bigint }[]> = {};

  async expensesByCategory(_spaceId: string, from: LocalDate) {
    return [...(this.expenses[from] ?? [])];
  }

  async transfersIntoAccounts(accountIds: readonly string[], from: LocalDate) {
    return (this.transfers[from] ?? []).filter((t) => accountIds.includes(t.accountId));
  }
}

/**
 * HU-E7 Background: Household (`space-household`, COP) with the HU-E6 members unless given (OWNER Ana, MEMBER
 * Juan, VIEWER Sofi, the guest Pedro), in-memory plans and the ledger's spending per period. `plan` stores a plan of
 * Household for a period label with its parts, ACTIVE unless told otherwise, as budgeting's use cases leave it.
 */
export const reportingWorld = (
  options: { readonly members?: readonly SpaceMember[]; readonly periodPolicy?: PeriodPolicy } = {},
) => {
  const w = budgetingWorld(options);
  const spending = new SpendingByPeriod();
  const deps: ReportingDeps = {
    access: w.deps.access,
    members: w.spaces,
    plans: w.plans,
    spending,
    savingsAccounts,
    categories: w.deps.categories,
  };
  let created = 0;
  const plan = async (
    label: string,
    parts: Partial<PlanContents> = {},
    extra: { readonly status?: PlanStatus; readonly createdFrom?: string } = {},
  ): Promise<BudgetPlan> => {
    const policy = options.periodPolicy ?? { kind: "MONTHLY", day: 1 };
    const period = unwrap(periodByLabel(policy, await w.plans.storedPeriods(HOUSEHOLD), label));
    created += 1;
    const stored: BudgetPlan = {
      id: `plan-${created}` as BudgetPlanId,
      spaceId: HOUSEHOLD,
      period,
      status: extra.status ?? "ACTIVE",
      createdFrom: (extra.createdFrom ?? null) as BudgetPlanId | null,
      version: 1,
      createdBy: "u-ana",
      createdAt: NOW,
    };
    await w.plans.add(stored);
    w.plans.seed(stored.id, parts);
    return stored;
  };
  return { ...w, spending, deps, plan };
};
