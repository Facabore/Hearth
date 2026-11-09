import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { rolledUpCategory, rolledUpSpending, type CategoryParent } from "../domain/category-rollup";
import type { BudgetPlan } from "../domain/plan";
import { carriesFromSource } from "../domain/rollover";
import {
  lineForCategory,
  planFigures,
  type CarrySource,
  type PlanFigures,
  type PreviousAvailable,
} from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import { ownedByRegisteredMember } from "./line-checks";
import type { BudgetAccount, PlanContents, PlanHistory, PlanSpending, SavingsAccountReader } from "./ports";

/** A plan with every figure derived on read (D7), its amounts in the space currency. */
export interface BudgetPlanView {
  readonly plan: BudgetPlan;
  readonly currency: string;
  readonly figures: PlanFigures;
}

type ViewDeps = Pick<
  BudgetingDeps,
  "members" | "plans" | "spending" | "savingsAccounts" | "categories" | "history"
>;

/** What walking a chain of plans reads: each plan, its contents, its spending and the accounts its lines name. */
export interface ChainReads {
  readonly plans: Pick<BudgetingDeps["plans"], "find" | "contents" | "covering">;
  readonly spending: PlanSpending;
  readonly savingsAccounts: SavingsAccountReader;
}

/** What reading a plan's figures takes; reporting reads plans through the same ports (HU-E7-01, ruling P32). */
export type PlanViewDeps = ViewDeps;

/**
 * What one view reads once and shares along the chain of plans it walks: the space's current members and its
 * categories with their parents (HU-E3-04), so every plan of the chain is figured against the same tree.
 */
export interface ViewReads {
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
  /** The chain reads of each space, answered from its plan history (`historyReads`), by space id. */
  readonly chains: Map<string, Promise<ChainReads>>;
}

export const planViewCache = (): PlanViewCache => ({
  reads: new Map(),
  figures: new Map(),
  chains: new Map(),
});

/** How a view walks its chain of plans: the plans already on it, and the request's cache if it has one. */
interface Walk {
  readonly seen: ReadonlySet<string>;
  readonly cache?: PlanViewCache;
}

/** HU-E6-09, ruling P243 (M6c): where a plan's lines carry from, and what the CLOSED source has available. */
interface Carry {
  /** The plan this one was copied from; null without one, or when none of its lines carries. */
  readonly source: CarrySource | null;
  /** The source's available amounts, by line; empty unless the source is CLOSED. */
  readonly available: PreviousAvailable[];
}

const NO_CARRY: Carry = { source: null, available: [] };

/**
 * HU-E6-09: what the lines of the plan `plan` was copied from have available, read only when one of its lines
 * carries over (an origin and a mode other than RESET). The chain follows createdFrom, which always names an
 * earlier plan, so it ends; `seen` stops it anyway. An earlier plan carries only once CLOSED (ruling P243, amending
 * P15); a chain walks on only through CLOSED plans, and an open source is named without being figured.
 * The cache is followed only to a plan of an earlier period, as every copy names one (HU-E6-06), so views that share
 * it never wait on each other; a source that is not earlier (malformed rows) is figured without it, as before.
 */
const carryOf = async (
  deps: ChainReads,
  space: SpaceMembership,
  plan: BudgetPlan,
  context: {
    readonly parts: PlanContents;
    readonly reads: ViewReads;
    readonly walk: Walk;
  },
): Promise<Carry> => {
  const { seen, cache } = context.walk;
  if (!carriesFromSource(context.parts.lines) || plan.createdFrom === null || seen.has(plan.createdFrom))
    return NO_CARRY;
  const source = await deps.plans.find(space.spaceId, plan.createdFrom);
  if (source === null) return NO_CARRY;
  if (source.status !== "CLOSED") {
    // Nothing of an open source is figured, so no spending is read: its lines only tell which origins it still holds.
    const lineIds = (await deps.plans.contents(source.id)).lines.map((line) => line.id);
    return { source: { planId: source.id, period: source.period, closed: false, lineIds }, available: [] };
  }
  const walk = { seen: new Set([...seen, plan.id]) };
  const figures =
    cache !== undefined && source.period.start < plan.period.start
      ? await cachedFiguresOf(deps, space, source, context.reads, { ...walk, cache })
      : await figuresOf(deps, space, source, context.reads, walk);
  return {
    source: {
      planId: source.id,
      period: source.period,
      closed: true,
      lineIds: figures.lines.map((figure) => figure.line.id),
    },
    available: figures.lines.map((figure) => ({ lineId: figure.line.id, available: figure.available })),
  };
};

/** The figures of `plan` for the current members: its parts, the spending within its stored dates, its carry-over. */
const figuresOf = async (
  deps: ChainReads,
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
  const carry = await carryOf(deps, space, plan, { parts, reads, walk });
  return planFigures({
    currency: space.currency,
    memberIds: members.map((m) => m.id),
    parts,
    spending,
    previousAvailable: carry.available,
    source: carry.source,
  });
};

/** Ruling P105: `plan`'s figures from the request's cache, computed by the first view that reaches it. */
const cachedFiguresOf = (
  deps: ChainReads,
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
 * The space's current members and categories as the request's views read them (ruling P105): read once per space and
 * request, so a report that also needs them reuses the ones its view was figured against.
 */
export const viewReadsOf = (
  deps: ViewDeps,
  space: SpaceMembership,
  cache: PlanViewCache,
): Promise<ViewReads> => {
  let reads = cache.reads.get(space.spaceId);
  if (reads === undefined) {
    reads = viewReads(deps, space);
    cache.reads.set(space.spaceId, reads);
  }
  return reads;
};

/**
 * The chain reads of `spaceId` answered from its plan history, read in one batch: a plan of the space, its contents,
 * and the spending within a plan's stored dates come from the history; anything else (another space, other dates, an
 * account no line of that plan names) is read as before. Each account is looked up once per request.
 */
const historyReads = (deps: ViewDeps, spaceId: string, history: PlanHistory): ChainReads => {
  const plans = new Map(history.plans.map((plan) => [plan.id as string, plan]));
  const planOf = (from: string, to: string) =>
    history.plans.find((plan) => plan.period.start === from && plan.period.end === to);
  const named = new Map(
    history.plans.map((plan) => [
      plan.id as string,
      new Set(history.contents.get(plan.id)?.lines.flatMap((line) => line.savingsAccountIds) ?? []),
    ]),
  );
  const accounts = new Map<string, Promise<BudgetAccount | null>>();
  return {
    plans: {
      find: async (space, planId) =>
        space === spaceId && plans.has(planId) ? plans.get(planId)! : deps.plans.find(space, planId),
      // As the repository answers it: the latest-starting plan whose stored dates hold `date`; a lock reads the row.
      covering: async (space, date, options) =>
        space !== spaceId || options?.share === true
          ? deps.plans.covering(space, date, options)
          : (history.plans.findLast((plan) => plan.period.start <= date && date <= plan.period.end) ?? null),
      contents: async (planId) => history.contents.get(planId) ?? deps.plans.contents(planId),
    },
    spending: {
      expensesByCategory: async (space, from, to) => {
        const plan = space === spaceId ? planOf(from, to) : undefined;
        const rows = plan === undefined ? undefined : history.expenses.get(plan.id);
        return rows === undefined ? deps.spending.expensesByCategory(space, from, to) : [...rows];
      },
      transfersIntoAccounts: async (accountIds, from, to) => {
        const plan = planOf(from, to);
        const rows = plan === undefined ? undefined : history.transfers.get(plan.id);
        const known = plan === undefined ? undefined : named.get(plan.id);
        return rows === undefined || known === undefined || !accountIds.every((id) => known.has(id))
          ? deps.spending.transfersIntoAccounts(accountIds, from, to)
          : rows.filter((row) => accountIds.includes(row.accountId));
      },
    },
    savingsAccounts: {
      find: (accountId) => {
        let account = accounts.get(accountId);
        if (account === undefined) {
          account = deps.savingsAccounts.find(accountId);
          accounts.set(accountId, account);
        }
        return account;
      },
    },
  };
};

/**
 * The plan, spending and account reads of `space` for this request: answered from the space's plan history once a view
 * of the request read it, else read as the ports answer them. Reports read through it what their views already read.
 */
export const requestReadsOf = (
  deps: ViewDeps,
  space: SpaceMembership,
  cache: PlanViewCache,
): ChainReads | Promise<ChainReads> => cache.chains.get(space.spaceId) ?? deps;

/**
 * What `plan`'s view reads its chain through: a copy (its createdFrom set) may walk back through every earlier plan, so
 * with a history reader it reads the space's history once (per request, with a cache) instead of plan by plan.
 */
const chainReadsOf = (
  deps: ViewDeps,
  space: SpaceMembership,
  plan: BudgetPlan,
  cache?: PlanViewCache,
): ChainReads | Promise<ChainReads> => {
  const reader = deps.history;
  if (reader === undefined || plan.createdFrom === null) return cache?.chains.get(space.spaceId) ?? deps;
  const read = () =>
    reader.historyOf(space.spaceId).then((history) => historyReads(deps, space.spaceId, history));
  if (cache === undefined) return read();
  let chain = cache.chains.get(space.spaceId);
  if (chain === undefined) {
    chain = read();
    cache.chains.set(space.spaceId, chain);
  }
  return chain;
};

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
    const reads = await viewReads(deps, space);
    const figures = await figuresOf(await chainReadsOf(deps, space, plan), space, plan, reads, {
      seen: new Set(),
    });
    return { plan, currency: space.currency, figures };
  }
  const reads = await viewReadsOf(deps, space, cache);
  const chain = await chainReadsOf(deps, space, plan, cache);
  const figures = await cachedFiguresOf(chain, space, plan, reads, { seen: new Set(), cache });
  return { plan, currency: space.currency, figures };
};

/** Ruling P234 (M6c): the line a category's expenses consume in the plan; null when they go to Unbudgeted. */
export interface CategoryLine {
  readonly categoryId: string;
  readonly lineId: string | null;
}

/**
 * HU-E6-04, HU-E3-04: for each category, the line its expenses consume in `view`'s plan, by the rule the figures
 * use: its mapped line, its parent's line for a subcategory, else the catch-all line, else none (Unbudgeted).
 */
export const categoryLinesOf = (
  view: BudgetPlanView,
  categories: readonly CategoryParent[],
): CategoryLine[] => {
  const parts = partsOf(view);
  return categories.map((category) => ({
    categoryId: category.id,
    lineId: lineForCategory(rolledUpCategory(category.id, categories), parts),
  }));
};

/** The lines and the mappings the figures counted, as `lineForCategory` reads them. */
const partsOf = (view: BudgetPlanView) => ({
  lines: view.figures.lines.map((figure) => figure.line),
  mappings: view.figures.lines.flatMap((figure) =>
    figure.categoryIds.map((categoryId) => ({ lineId: figure.line.id, categoryId })),
  ),
});

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * #240 (board E9-10 01): the categories whose spending reached Unbudgeted, by the rule the figures use: each expense
 * counts in its rolled-up category (HU-E3-04), which no line consumes in `view`'s plan; every category without a
 * plan (ruling P33). The most spent first, ties by id; a category with nothing spent is left out.
 */
export const unbudgetedCategoriesOf = (
  view: BudgetPlanView | null,
  categories: readonly CategoryParent[],
  spending: readonly { readonly categoryId: string; readonly amount: bigint }[],
): string[] => {
  const parts = view === null ? null : partsOf(view);
  return rolledUpSpending(spending, categories)
    .filter(
      ({ categoryId, amount }) =>
        amount !== 0n && (parts === null || lineForCategory(categoryId, parts) === null),
    )
    .sort((a, b) =>
      a.amount !== b.amount ? (a.amount > b.amount ? -1 : 1) : ordinal(a.categoryId, b.categoryId),
    )
    .map(({ categoryId }) => categoryId);
};
