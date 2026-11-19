import {
  categoryLinesOf,
  type CategoryLine,
  type Funding,
  type LineFigure,
  planViewCache,
  requestReadsOf,
  unbudgetedCategoriesOf,
  viewReadsOf,
} from "@/modules/budgeting/application";
import { ok, type Period, type Result } from "@/shared/kernel";
import { lineStateOf, type LineState } from "@/shared/kernel/line-state";
import type { ReportingDeps } from "./deps";
import { reportPlanOf, spaceReport, type ReportPlan, type SpaceReportInput } from "./space-report";

/**
 * Ruling P342 (S7): a line's figures in one currency, never converted ("se pasó 40.000 COP", "quedan 55 USD"). A
 * currency the line does not budget is listed only when it spent or carried in it (`budgeted` false, planned 0).
 */
export interface DashboardBudget {
  readonly currency: string;
  readonly budgeted: boolean;
  readonly planned: bigint;
  readonly spent: bigint;
  readonly carryOver: bigint;
  readonly available: bigint;
  readonly overspent: boolean;
  /** Ruling P244 (M6c): of planned + carry-over in this currency; a SAVINGS line is always OK. */
  readonly state: LineState;
  readonly overBy: bigint | null;
}

/** HU-E7-01: one budget line of the period's plan; `overspent` while its available amount is negative. */
export interface DashboardLine {
  readonly lineId: string;
  readonly name: string;
  readonly funding: Funding;
  readonly isCatchAll: boolean;
  readonly planned: bigint;
  readonly spent: bigint;
  readonly carryOver: bigint;
  /** Ruling P243 (M6c): the plan the carry-over comes from; it carries only once that plan is CLOSED. */
  readonly carryOverFrom: LineFigure["carryOverFrom"];
  readonly available: bigint;
  readonly overspent: boolean;
  /** Ruling P244 (M6c): of planned + carry-over; a SAVINGS line is always OK. */
  readonly state: LineState;
  /** How much an OVER line went past its budget, positive; null otherwise. */
  readonly overBy: bigint | null;
  /**
   * Ruling P342 (S7): every currency of the line, its budgets first in the line's order. The scalar figures above are
   * the space currency's.
   */
  readonly budgets: readonly DashboardBudget[];
}

/** Spending no line consumes, available = −spent (HU-E6-04); `overspent` once anything was spent there. */
export interface UnbudgetedSpending {
  readonly spent: bigint;
  readonly available: bigint;
  readonly overspent: boolean;
  /** #240 (board E9-10 01): the categories its spending fell into, rolled up (HU-E3-04), the most spent first. */
  readonly categoryIds: readonly string[];
}

/**
 * Ruling P201 (M6c): the dashboard's own sums, so a client never adds figures up. `planned` counts the lines only
 * (Unbudgeted plans nothing, HU-E6-04); `spent` and `available` count Unbudgeted too.
 */
export interface LineTotals {
  readonly planned: bigint;
  readonly spent: bigint;
  readonly available: bigint;
  /** #214 (ruling P262): Σ what reached the SAVINGS lines, which `spent` also counts. */
  readonly saved: bigint;
  /**
   * #214 (ruling P262): `planned` and `spent` without the SAVINGS lines, for the "Gastado … de …" headline. #283
   * (ruling P313): `available` too, what is left to spend, so savings not yet moved never read as money to spend.
   */
  readonly withoutSavings: { readonly planned: bigint; readonly spent: bigint; readonly available: bigint };
}

/**
 * Ruling P342 (S7): the dashboard's sums and Unbudgeted in one currency ("Quedan 1.286.000 COP y 55 USD"), never
 * converted.
 */
export interface DashboardCurrency {
  readonly currency: string;
  readonly unbudgeted: UnbudgetedSpending | null;
  readonly totals: LineTotals;
}

export interface LineDashboard {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  /** Null when the period has no plan; every expense is then Unbudgeted (ruling P33). */
  readonly plan: ReportPlan | null;
  /** The plan's lines in plan order; none without a plan. */
  readonly lines: readonly DashboardLine[];
  /** Null when the plan has a catch-all line, which consumes every unmapped category (HU-E6-04, ruling P34). */
  readonly unbudgeted: UnbudgetedSpending | null;
  readonly totals: LineTotals;
  /** Ruling P234 (M6c): the line each live category consumes; [] without a plan. */
  readonly categoryLines: readonly CategoryLine[];
  /**
   * Ruling P342 (S7): the space currency first, then every other currency the plan or the period's spending holds,
   * alphabetically; the scalar `unbudgeted` and `totals` are the space currency's.
   */
  readonly currencies: readonly DashboardCurrency[];
}

export type GetLineDashboard = (input: SpaceReportInput) => Promise<Result<LineDashboard>>;

const unbudgeted = (spent: bigint, categoryIds: readonly string[]): UnbudgetedSpending => ({
  spent,
  available: -spent,
  overspent: spent > 0n,
  categoryIds,
});

type Summed = Pick<DashboardLine, "funding" | "planned" | "spent" | "available">;

const sumOf = (lines: readonly Summed[], figure: "planned" | "spent" | "available"): bigint =>
  lines.reduce((sum, line) => sum + line[figure], 0n);

const totalsOf = (lines: readonly Summed[], rest: UnbudgetedSpending | null): LineTotals => {
  const spending = lines.filter((line) => line.funding !== "SAVINGS");
  const savings = lines.filter((line) => line.funding === "SAVINGS");
  return {
    planned: sumOf(lines, "planned"),
    spent: sumOf(lines, "spent") + (rest?.spent ?? 0n),
    available: sumOf(lines, "available") + (rest?.available ?? 0n),
    saved: sumOf(savings, "spent"),
    withoutSavings: {
      planned: sumOf(spending, "planned"),
      spent: sumOf(spending, "spent") + (rest?.spent ?? 0n),
      available: sumOf(spending, "available") + (rest?.available ?? 0n),
    },
  };
};

type Spent = readonly { readonly categoryId: string; readonly currency: string; readonly amount: bigint }[];

/** Ruling P342 (S7): the rows in `currency`, as the single-currency figures read them. */
const spentIn = (spending: Spent, currency: string) =>
  spending
    .filter((row) => row.currency === currency)
    .map(({ categoryId, amount }) => ({ categoryId, amount }));

/** Ruling P342 (S7): the currencies of the rows, alphabetically, past `first`. */
const currenciesOf = (first: readonly string[], spending: Spent): string[] => [
  ...first,
  ...[...new Set(spending.map((row) => row.currency))].filter((c) => !first.includes(c)).sort(),
];

/**
 * HU-E7-01, ruling P342 (S7): a line's figures in one currency, as the plan derives them; a SAVINGS line reaching its
 * plan is the goal, so it is never measured (P244).
 */
const budgetOf = (
  funding: Funding,
  b:
    | LineFigure["budgets"][number]
    | {
        currency: string;
        budgeted: boolean;
        planned: bigint;
        spent: bigint;
        carryOver: bigint;
        available: bigint;
      },
): DashboardBudget => ({
  currency: b.currency,
  budgeted: b.budgeted,
  planned: b.planned,
  spent: b.spent,
  carryOver: b.carryOver,
  available: b.available,
  overspent: b.available < 0n,
  state: funding === "SAVINGS" ? "OK" : lineStateOf(b.planned + b.carryOver, b.available),
  overBy: funding !== "SAVINGS" && b.available < 0n ? -b.available : null,
});

/** A currency a line holds nothing in. */
const nothingIn = (currency: string) => ({
  currency,
  budgeted: false,
  planned: 0n,
  spent: 0n,
  carryOver: 0n,
  available: 0n,
});

/**
 * HU-E7-01: planned, spent, carry-over and available per line of the period's plan, exactly as the plan reports
 * them (`loadPlanView`, spec 5.4, ruling P32), computed on read (D7).
 */
export const createGetLineDashboard =
  (deps: ReportingDeps): GetLineDashboard =>
  async (input) => {
    const cache = planViewCache();
    const report = await spaceReport(deps, input, cache);
    if (!report.ok) return report;
    const { space, period, view } = report.value;
    const base = { spaceId: space.spaceId, currency: space.currency, period, plan: reportPlanOf(view) };
    // The categories and the spending the view was figured from, read once in the request.
    if (view === null) {
      const categories = await deps.categories.list(space.spaceId);
      // Ruling P342 (S7): every expense in its own currency, each currency apart.
      const spending = await deps.spending.expensesByCategoryByCurrency(
        space.spaceId,
        period.start,
        period.end,
      );
      const currencies = currenciesOf([space.currency], spending).map((currency): DashboardCurrency => {
        const rows = spentIn(spending, currency);
        const rest = unbudgeted(
          rows.reduce((sum, c) => sum + c.amount, 0n),
          unbudgetedCategoriesOf(null, categories, rows),
        );
        return { currency, unbudgeted: rest, totals: totalsOf([], rest) };
      });
      const own = currencies[0]!;
      return ok({
        ...base,
        lines: [],
        unbudgeted: own.unbudgeted,
        totals: own.totals,
        categoryLines: [],
        currencies,
      });
    }
    const { categories } = await viewReadsOf(deps, space, cache);
    const { figures } = view;
    const lines = figures.lines.map((f): DashboardLine => ({
      lineId: f.line.id,
      name: f.line.name,
      funding: f.line.funding,
      isCatchAll: f.line.isCatchAll,
      planned: f.planned,
      spent: f.spent,
      carryOver: f.carryOver,
      carryOverFrom: f.carryOverFrom,
      available: f.available,
      overspent: f.available < 0n,
      // Ruling P244 (M6c): a savings line reaching its plan is the goal, so it is never measured.
      state: f.line.funding === "SAVINGS" ? "OK" : lineStateOf(f.planned + f.carryOver, f.available),
      overBy: f.line.funding !== "SAVINGS" && f.available < 0n ? -f.available : null,
      budgets: f.budgets.map((b) => budgetOf(f.line.funding, b)),
    }));
    // #240: Unbudgeted's categories within the plan's stored dates, each currency's own (P342, S7).
    const anyUnbudgeted = figures.currencies.some((c) => (c.unbudgeted?.spent ?? 0n) !== 0n);
    const spending: Spent = anyUnbudgeted
      ? await (
          await requestReadsOf(deps, space, cache)
        ).spending.expensesByCategoryByCurrency(space.spaceId, view.plan.period.start, view.plan.period.end)
      : [];
    const currencies = figures.currencies.map((c): DashboardCurrency => {
      const rest =
        c.unbudgeted === null
          ? null
          : unbudgeted(
              c.unbudgeted.spent,
              c.unbudgeted.spent === 0n
                ? []
                : unbudgetedCategoriesOf(view, categories, spentIn(spending, c.currency)),
            );
      const inCurrency = lines.map((line) => ({
        funding: line.funding,
        ...(line.budgets.find((b) => b.currency === c.currency) ?? nothingIn(c.currency)),
      }));
      return { currency: c.currency, unbudgeted: rest, totals: totalsOf(inCurrency, rest) };
    });
    const own = currencies[0]!;
    const categoryLines = categoryLinesOf(view, categories);
    return ok({
      ...base,
      lines,
      unbudgeted: own.unbudgeted,
      totals: own.totals,
      categoryLines,
      currencies,
    });
  };
