import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { rolledUpCategory, rolledUpSpending, type CategoryParent } from "../domain/category-rollup";
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

/** What reading a plan's figures takes; reporting reads plans through the same ports (HU-E7-01, ruling P32). */
export type PlanViewDeps = ViewDeps;

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
 * Ruling P105: what one request has figured, shared by every view it loads. Within one request every view of a
 * space is figured against the same members and categories, so a plan's figures are the same in every view whose
 * chain reaches it: they are computed once, by plan id, and a request costs O(window + chain) plan computations.
 * Create one per request with `planViewCache` and pass it to each `loadPlanView` of that request.
 */
export interface PlanViewCache {
  /** The members and categories of each space, by space id. */
  readonly reads: Map<string, Promise<ViewReads>>;
  /** The figures of each plan, by plan id; the promise is shared while it is being computed. */
  readonly figures: Map<string, Promise<PlanFigures>>;
}

export const planViewCache = (): PlanViewCache => ({ reads: new Map(), figures: new Map() });

/** How a view walks its chain of plans: the plans already on it, and the request's cache if it has one. */
interface Walk {
  readonly seen: ReadonlySet<string>;
  readonly cache?: PlanViewCache;
}

/**
 * HU-E6-09: what the lines of the plan `plan` was copied from have available, read only when one of its lines
 * carries over (an origin and a mode other than RESET). The chain follows createdFrom, which always names an
 * earlier plan, so it ends; `seen` stops it anyway. Earlier plans are read whatever their status (ruling P15).
 * The cache is followed only to a plan of an earlier period, as every copy names one (HU-E6-06), so views that share
 * it never wait on each other; a source that is not earlier (malformed rows) is figured without it, as before.
 */
const previousAvailable = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  context: {
    readonly parts: PlanContents;
    readonly reads: ViewReads;
    readonly walk: Walk;
  },
): Promise<PreviousAvailable[]> => {
  const { seen, cache } = context.walk;
  const rolls = context.parts.lines.some(
    (line) => line.originLineId !== null && line.rolloverMode !== "RESET",
  );
  if (!rolls || plan.createdFrom === null || seen.has(plan.createdFrom)) return [];
  const source = await deps.plans.find(space.spaceId, plan.createdFrom);
  if (source === null) return [];
  const walk = { seen: new Set([...seen, plan.id]) };
  const figures =
    cache !== undefined && source.period.start < plan.period.start
      ? await cachedFiguresOf(deps, space, source, context.reads, { ...walk, cache })
      : await figuresOf(deps, space, source, context.reads, walk);
  return figures.lines.map((figure) => ({ lineId: figure.line.id, available: figure.available }));
};

/** The figures of `plan` for the current members: its parts, the spending within its stored dates, its carry-over. */
const figuresOf = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  reads: ViewReads,
  walk: Walk,
): Promise<PlanFigures> => {
  const { members, categories } = reads;
  const stored = await deps.plans.contents(plan.id);
  // A line lists a category exactly when it counts there: the mapping of a category that became a subcategory stays
  // stored (D8) but is hidden, since its spending counts where its parent is mapped (HU-E3-04). Promoted, it shows again.
  const parts = {
    ...stored,
    mappings: stored.mappings.filter((m) => rolledUpCategory(m.categoryId, categories) === m.categoryId),
  };
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
    previousAvailable: await previousAvailable(deps, space, plan, { parts, reads, walk }),
  });
};

/** Ruling P105: `plan`'s figures from the request's cache, computed by the first view that reaches it. */
const cachedFiguresOf = (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  reads: ViewReads,
  walk: Walk & { readonly cache: PlanViewCache },
): Promise<PlanFigures> => {
  const cached = walk.cache.figures.get(plan.id);
  if (cached !== undefined) return cached;
  const figures = figuresOf(deps, space, plan, reads, walk);
  walk.cache.figures.set(plan.id, figures);
  return figures;
};

const viewReads = async (deps: ViewDeps, space: SpaceMembership): Promise<ViewReads> => ({
  members: await deps.members.listCurrent(space.spaceId),
  categories: await deps.categories.list(space.spaceId),
});

/**
 * The plan's parts, its space's current members, the spending within its stored dates and its carry-over. A request
 * that loads several views passes one `cache` to all of them (ruling P105); without it the view reads everything.
 */
export const loadPlanView = async (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  cache?: PlanViewCache,
): Promise<BudgetPlanView> => {
  if (cache === undefined) {
    const figures = await figuresOf(deps, space, plan, await viewReads(deps, space), { seen: new Set() });
    return { plan, currency: space.currency, figures };
  }
  let reads = cache.reads.get(space.spaceId);
  if (reads === undefined) {
    reads = viewReads(deps, space);
    cache.reads.set(space.spaceId, reads);
  }
  const figures = await cachedFiguresOf(deps, space, plan, await reads, { seen: new Set(), cache });
  return { plan, currency: space.currency, figures };
};
