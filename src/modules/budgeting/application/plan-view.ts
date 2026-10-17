import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { rolledUpSpending, type CategoryParent } from "../domain/category-rollup";
import type { BudgetPlan } from "../domain/plan";
import { planFigures, type PlanFigures, type PreviousAvailable } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import { ownedByRegisteredMember } from "./line-checks";
import type { PlanContents, SavingsAccountReader } from "./ports";

/** A plan with every figure derived on read (D7), its amounts in the space currency. */
export interface BudgetPlanView {
  readonly plan: BudgetPlan;
  readonly currency: string;
  readonly figures: PlanFigures;
}

type ViewDeps = Pick<BudgetingDeps, "members" | "plans" | "spending" | "savingsAccounts" | "categories">;

/**
 * What one view reads once and shares along the chain of plans it walks: the space's current members and its
 * categories with their parents (HU-E3-04), so every plan of the chain is figured against the same tree.
 */
interface ViewReads {
  readonly members: readonly SpaceMember[];
  readonly categories: readonly CategoryParent[];
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
  const counts = ownedByRegisteredMember(members);
  // Resolved together; Promise.all keeps the order of the ids, so the counted ones keep the lines' order.
  const found = await Promise.all(
    accountIds.map(async (accountId) => ({ accountId, account: await accounts.find(accountId) })),
  );
  return found.filter(({ account }) => account !== null && counts(account)).map(({ accountId }) => accountId);
};

/**
 * HU-E6-09: what the lines of the plan `plan` was copied from have available, read only when one of its lines
 * carries over (an origin and a mode other than RESET). The chain follows createdFrom, which always names an
 * earlier plan, so it ends; `seen` stops it anyway. Earlier plans are read whatever their status (ruling P15).
 */
const previousAvailable = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  context: {
    readonly parts: PlanContents;
    readonly reads: ViewReads;
    readonly seen: ReadonlySet<string>;
  },
): Promise<PreviousAvailable[]> => {
  const rolls = context.parts.lines.some(
    (line) => line.originLineId !== null && line.rolloverMode !== "RESET",
  );
  if (!rolls || plan.createdFrom === null || context.seen.has(plan.createdFrom)) return [];
  const source = await deps.plans.find(space.spaceId, plan.createdFrom);
  if (source === null) return [];
  const figures = await figuresOf(deps, space, source, context.reads, new Set([...context.seen, plan.id]));
  return figures.lines.map((figure) => ({ lineId: figure.line.id, available: figure.available }));
};

/** The figures of `plan` for the current members: its parts, the spending within its stored dates, its carry-over. */
const figuresOf = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  reads: ViewReads,
  seen: ReadonlySet<string>,
): Promise<PlanFigures> => {
  const { members, categories } = reads;
  const parts = await deps.plans.contents(plan.id);
  const { start, end } = plan.period;
  const accountIds = await accountsOfMembers(
    deps.savingsAccounts,
    members,
    parts.lines.flatMap((line) => line.savingsAccountIds),
  );
  const spending = {
    // HU-E3-04: a subcategory's expenses count where its category is mapped, the catch-all and Unbudgeted included.
    byCategory: rolledUpSpending(
      await deps.spending.expensesByCategory(space.spaceId, start, end),
      categories,
    ),
    byAccount:
      accountIds.length === 0 ? [] : await deps.spending.transfersIntoAccounts(accountIds, start, end),
  };
  return planFigures({
    currency: space.currency,
    memberIds: members.map((m) => m.id),
    parts,
    spending,
    previousAvailable: await previousAvailable(deps, space, plan, { parts, reads, seen }),
  });
};

/** The plan's parts, its space's current members, the spending within its stored dates and its carry-over. */
export const loadPlanView = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
): Promise<BudgetPlanView> => {
  const members = await deps.members.listCurrent(space.spaceId);
  const categories = await deps.categories.list(space.spaceId);
  const figures = await figuresOf(deps, space, plan, { members, categories }, new Set());
  return { plan, currency: space.currency, figures };
};
