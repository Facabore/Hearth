import type {
  BudgetPlan,
  BudgetPlanId,
  PlanContents,
  PlanSpending,
  PlanStatus,
} from "@/modules/budgeting/application";
import type { ReportingDeps, SpaceFunds, SpaceMemberSums } from "@/modules/reporting/application";
import type { SpaceMember } from "@/modules/spaces/application";
import { periodByLabel, type LocalDate, type PeriodPolicy } from "@/shared/kernel";
import { budgetingWorld, HOUSEHOLD, NOW, savingsAccounts } from "./budgeting-world";
import { unwrap } from "./fakes";

/**
 * The ledger's per-member sums of each period, keyed by the first day it is asked for (D7). A row without a currency is
 * in COP, Household's; P342 (S7): the single-currency sums answer only the COP rows, never converted.
 */
export class MemberSumsByPeriod implements SpaceMemberSums {
  readonly byCategory: Record<
    string,
    { categoryId: string; memberId: string; paid: bigint; consumed: bigint; currency?: string }[]
  > = {};
  readonly contributions: Record<string, { memberId: string; amount: bigint; currency?: string }[]> = {};

  async memberSumsByCategoryByCurrency(_spaceId: string, from: LocalDate) {
    return (this.byCategory[from] ?? []).map((row) => ({ ...row, currency: row.currency ?? "COP" }));
  }

  async fundContributionsByMemberByCurrency(_spaceId: string, from: LocalDate) {
    return (this.contributions[from] ?? []).map((row) => ({ ...row, currency: row.currency ?? "COP" }));
  }
  /** D26: the contributions that paid an expense for the fund, by the expense's category. */
  readonly forFund: Record<string, { categoryId: string; memberId: string; amount: bigint }[]> = {};

  async memberSumsByCategory(_spaceId: string, from: LocalDate) {
    return (this.byCategory[from] ?? [])
      .filter((row) => (row.currency ?? "COP") === "COP")
      .map(({ categoryId, memberId, paid, consumed }) => ({ categoryId, memberId, paid, consumed }));
  }

  async fundContributionsByMember(_spaceId: string, from: LocalDate) {
    return (this.contributions[from] ?? [])
      .filter((row) => (row.currency ?? "COP") === "COP")
      .map(({ memberId, amount }) => ({ memberId, amount }));
  }

  async paidForFundByCategory(_spaceId: string, from: LocalDate) {
    return [...(this.forFund[from] ?? [])];
  }
}

/** #240: each space's live fund accounts, as the accounts module lists them. */
export class FundsBySpace implements SpaceFunds {
  readonly bySpace: Record<string, { id: string; name: string }[]> = {};

  async fundsOf(spaceId: string) {
    return [...(this.bySpace[spaceId] ?? [])];
  }
}

/**
 * PlanSpending of each period, keyed by the first day the ledger is asked for, as it sums them on read (D7). A row
 * without a currency is in COP, Household's; P342 (S7): the single-currency sums answer only the rows in the currency
 * asked for (COP when none), never converted.
 */
export class SpendingByPeriod implements PlanSpending {
  readonly expenses: Record<string, { categoryId: string; amount: bigint; currency?: string }[]> = {};
  readonly transfers: Record<string, { accountId: string; amount: bigint; currency?: string }[]> = {};

  /** Every question asked of `expensesByCategory` or `expensesByCategoryByCurrency`, in order. */
  readonly expensesAsked: [spaceId: string, from: LocalDate, to: LocalDate][] = [];

  async expensesByCategoryByCurrency(spaceId: string, from: LocalDate, to: LocalDate) {
    this.expensesAsked.push([spaceId, from, to]);
    return (this.expenses[from] ?? []).map(({ categoryId, amount, currency }) => ({
      categoryId,
      currency: currency ?? "COP",
      amount,
    }));
  }

  async transfersIntoAccountsByCurrency(accountIds: readonly string[], from: LocalDate) {
    return (this.transfers[from] ?? [])
      .filter((t) => accountIds.includes(t.accountId))
      .map(({ accountId, amount, currency }) => ({ accountId, currency: currency ?? "COP", amount }));
  }

  async expensesByCategory(spaceId: string, from: LocalDate, to: LocalDate, currency = "COP") {
    this.expensesAsked.push([spaceId, from, to]);
    return (this.expenses[from] ?? [])
      .filter((e) => (e.currency ?? "COP") === currency)
      .map(({ categoryId, amount }) => ({ categoryId, amount }));
  }

  async transfersIntoAccounts(
    accountIds: readonly string[],
    from: LocalDate,
    _to?: LocalDate,
    currency = "COP",
  ) {
    return (this.transfers[from] ?? [])
      .filter((t) => accountIds.includes(t.accountId) && (t.currency ?? "COP") === currency)
      .map(({ accountId, amount }) => ({ accountId, amount }));
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
  const sums = new MemberSumsByPeriod();
  const funds = new FundsBySpace();
  return {
    ...w,
    spending,
    sums,
    funds,
    deps,
    memberDeps: { ...deps, sums },
    fundDeps: { ...deps, sums, funds },
    plan,
  };
};
