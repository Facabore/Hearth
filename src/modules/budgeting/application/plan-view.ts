import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import type { BudgetPlan } from "../domain/plan";
import { planFigures, type PlanFigures } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import type { SavingsAccountReader } from "./ports";

/** A plan with every figure derived on read (D7), its amounts in the space currency. */
export interface BudgetPlanView {
  readonly plan: BudgetPlan;
  readonly currency: string;
  readonly figures: PlanFigures;
}

/**
 * P8: of the accounts SAVINGS lines name, the ones whose owner is a current registered member of the plan's space.
 * The account of a member who left stays on its line but stops counting, for every reader.
 */
const accountsOfMembers = async (
  accounts: SavingsAccountReader,
  members: readonly SpaceMember[],
  accountIds: readonly string[],
): Promise<string[]> => {
  const owners = new Set(members.flatMap((m) => (m.userId === null ? [] : [m.userId])));
  const counted: string[] = [];
  for (const accountId of accountIds) {
    const account = await accounts.find(accountId);
    if (account !== null && owners.has(account.ownerUserId)) counted.push(accountId);
  }
  return counted;
};

/** The plan's parts, its space's current members and the spending within its stored dates, as figures. */
export const loadPlanView = async (
  deps: Pick<BudgetingDeps, "members" | "plans" | "spending" | "savingsAccounts">,
  space: SpaceMembership,
  plan: BudgetPlan,
): Promise<BudgetPlanView> => {
  const members = await deps.members.listCurrent(space.spaceId);
  const parts = await deps.plans.contents(plan.id);
  const { start, end } = plan.period;
  const accountIds = await accountsOfMembers(
    deps.savingsAccounts,
    members,
    parts.lines.flatMap((line) => line.savingsAccountIds),
  );
  const spending = {
    byCategory: await deps.spending.expensesByCategory(space.spaceId, start, end),
    byAccount:
      accountIds.length === 0 ? [] : await deps.spending.transfersIntoAccounts(accountIds, start, end),
  };
  return {
    plan,
    currency: space.currency,
    figures: planFigures({ currency: space.currency, memberIds: members.map((m) => m.id), parts, spending }),
  };
};
