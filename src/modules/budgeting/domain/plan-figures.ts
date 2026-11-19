import { domainError, err, ok, type Period, type Result } from "@/shared/kernel";
import { assignedAmounts, type LineAllocation } from "./allocation";
import type { AllocationRule, BudgetLine, CategoryMapping } from "./budget-line";
import { capacityOf, shareOfTotal, totalCapacity, type MemberCapacity } from "./capacity";
import { amountIn, currencyOrder, holds, type CurrencyAmount } from "./currency-amount";
import { carryOver } from "./rollover";

/** What a plan holds: its capacities, current lines, current category mappings and current allocation values. */
export interface PlanParts {
  readonly capacities: readonly MemberCapacity[];
  readonly lines: readonly BudgetLine[];
  readonly mappings: readonly CategoryMapping[];
  readonly allocations: readonly LineAllocation[];
}

/**
 * Spec 5.4: what was spent in the plan's period, summed by the ledger on read (D7). Ruling P342 (S7): per currency,
 * each movement in its own; a movement counts only against a budget in its currency, never converted.
 */
export interface PeriodSpending {
  /** Σ live expenses of the plan's space per category and currency. */
  readonly byCategory: readonly {
    readonly categoryId: string;
    readonly currency: string;
    readonly amount: bigint;
  }[];
  /** Σ live transfers into each account that a SAVINGS line names, per currency. */
  readonly byAccount: readonly {
    readonly accountId: string;
    readonly currency: string;
    readonly amount: bigint;
  }[];
}

/** HU-E6-09: what a line of the plan this one was copied from has available, per currency, by that line's id. */
export interface PreviousAvailable {
  readonly lineId: string;
  readonly available: readonly CurrencyAmount[];
}

/**
 * HU-E6-09, ruling P243 (M6c): the plan this one was copied from, as its carry-over reads it. Only a CLOSED source
 * carries; before it closes, `previousAvailable` is empty and its lines say they wait for it.
 */
export interface CarrySource {
  readonly planId: string;
  readonly period: Period;
  readonly closed: boolean;
  /** The source's current lines: a line carries only from the line it was copied from, if the source still has it. */
  readonly lineIds: readonly string[];
}

export interface CapacityFigure {
  readonly memberId: string;
  readonly amount: bigint;
  /** Basis points of total capacity (40.00 % = 4000); null without capacity. */
  readonly shareBasisPoints: number | null;
}

/** One member's part of one budget of a line. */
export interface AllocationMemberFigure {
  readonly memberId: string;
  /** The stored PERCENT basis points or FIXED minor units (of this currency); null for PROPORTIONAL and members without one. */
  readonly value: bigint | null;
  /** Null on an invalid allocation. */
  readonly assigned: bigint | null;
}

export interface AllocationFigure {
  readonly rule: AllocationRule;
  /** Every current member in join order; none on a NONE line. */
  readonly members: readonly AllocationMemberFigure[];
  /** HU-E6-05: InvalidAllocation, until the line is allocated again. P342 (S7): in any currency the line budgets. */
  readonly invalid: boolean;
}

/**
 * Ruling P342 (S7): a line's figures in one currency. A currency the line budgets has its planned amount; one it does
 * not budget appears only when something was spent or carried in it (`budgeted` false, planned 0), never converted.
 */
export interface LineCurrencyFigure {
  readonly currency: string;
  readonly budgeted: boolean;
  readonly planned: bigint;
  /** The planned amount as basis points of the capacity in this currency; null without capacity in it. */
  readonly capacityShareBasisPoints: number | null;
  /** HU-E6-05 by the line's rule in this currency; nobody's on a NONE line, nor on a currency it does not budget. */
  readonly allocation: { readonly members: readonly AllocationMemberFigure[]; readonly invalid: boolean };
  readonly spent: bigint;
  readonly carryOver: bigint;
  /** planned + carry-over − spent. */
  readonly available: bigint;
}

export interface LineFigure {
  readonly line: BudgetLine;
  readonly categoryIds: readonly string[];
  /** In the space currency, as before P342 T6; `budgets` holds every currency. */
  readonly capacityShareBasisPoints: number | null;
  /** The rule, and its members in the space currency; `invalid` when the allocation fails in any budgeted currency. */
  readonly allocation: AllocationFigure;
  /** The line's budget in the space currency; 0 when it plans none in it (P342, S7). */
  readonly planned: bigint;
  /** In the space currency (0 when nothing was spent in it). */
  readonly spent: bigint;
  /** HU-E6-09: carried from the line this one was copied from, by this line's rollover mode; 0 without one. */
  readonly carryOver: bigint;
  /** Ruling P243 (M6c): where the carry-over comes from; null for RESET or a line without an origin in the source. */
  readonly carryOverFrom: {
    readonly planId: string;
    readonly period: Period;
    readonly closed: boolean;
  } | null;
  /** In the space currency: its planned amount there (0 without one) + carry-over − spent. */
  readonly available: bigint;
  /**
   * P342 (S7): every currency of the line: its budgets in the line's order, then every other currency it spent or
   * carried in, alphabetically.
   */
  readonly budgets: readonly LineCurrencyFigure[];
}

/** Ruling P342 (S7): a plan's totals in one currency. */
export interface PlanCurrencyFigure {
  readonly currency: string;
  /** Every current member in join order with their capacity in this currency. */
  readonly capacities: readonly CapacityFigure[];
  readonly totalCapacity: bigint;
  readonly planned: bigint;
  /** "Por repartir": capacity − Σ planned in this currency; negative once capacity fell below the lines. */
  readonly unallocated: bigint;
  /** HU-E6-04: unmapped spending in this currency; null when the plan has a catch-all line. */
  readonly unbudgeted: { readonly spent: bigint; readonly available: bigint } | null;
}

export interface PlanFigures {
  /** In the space currency, as before P342 T6. */
  readonly capacities: readonly CapacityFigure[];
  readonly totalCapacity: bigint;
  readonly planned: bigint;
  /** Total capacity − Σ planned; negative once capacities were reduced below the lines (HU-E6-02). */
  readonly unallocated: bigint;
  readonly lines: readonly LineFigure[];
  /** HU-E6-04: the implicit line of unmapped spending; null when the plan has a catch-all line. */
  readonly unbudgeted: { readonly spent: bigint; readonly available: bigint } | null;
  /**
   * P342 (S7): the space currency first, then every currency a current member contributes, a line budgets or was
   * spent in, alphabetically.
   */
  readonly currencies: readonly PlanCurrencyFigure[];
}

/**
 * HU-E6-04: the line a category consumes: its mapped line, else the catch-all line, else Unbudgeted (null). A
 * mapping whose line is not a current line of the plan is ignored, so its spending is never lost.
 */
export const lineForCategory = (
  categoryId: string,
  parts: Pick<PlanParts, "lines" | "mappings">,
): string | null =>
  parts.mappings.find((m) => m.categoryId === categoryId && parts.lines.some((l) => l.id === m.lineId))
    ?.lineId ??
  parts.lines.find((l) => l.isCatchAll)?.id ??
  null;

/** `memberIds`, in their order, with the capacity each holds in `currency` in the plan (0 without one). */
const withCapacities = (
  capacities: readonly MemberCapacity[],
  memberIds: readonly string[],
  currency: string,
) => memberIds.map((memberId) => ({ memberId, capacity: capacityOf(capacities, memberId, currency) }));

/**
 * HU-E6-05: a line's allocation values in `currency` and the amounts they assign to `memberIds` (their order) of the
 * line's budget in it. The plan's figures and the default split (HU-E6-08) both read a line's assignment here, so the
 * two cannot drift. P342 (S7, "Misma regla, por moneda"): PERCENT shares hold for every currency, FIXED amounts are the
 * currency's own, PROPORTIONAL follows each member's capacity in it; a currency the line does not budget assigns 0.
 */
export const lineAssignment = (
  line: Pick<BudgetLine, "id" | "allocationRule" | "budgets">,
  parts: Pick<PlanParts, "capacities" | "allocations">,
  memberIds: readonly string[],
  currency: string,
) => {
  const values: readonly LineAllocation[] = parts.allocations.filter(
    (a) => a.lineId === line.id && (a.currency === null || a.currency === currency),
  );
  const members = withCapacities(parts.capacities, memberIds, currency);
  const planned = { currency, amount: amountIn(line.budgets, currency) };
  return { values, members, assigned: assignedAmounts(line.allocationRule, planned, values, members) };
};

const allocationIn = (
  line: BudgetLine,
  parts: PlanParts,
  memberIds: readonly string[],
  currency: string,
): LineCurrencyFigure["allocation"] => {
  if (line.allocationRule === "NONE") return { members: [], invalid: false };
  const { values, members, assigned } = lineAssignment(line, parts, memberIds, currency);
  const budgeted = holds(line.budgets, currency);
  // A currency the line does not budget assigns nothing to anyone, and never flags the line.
  const amounts = !budgeted ? null : assigned.ok ? assigned.value : null;
  return {
    members: members.map((m) => ({
      memberId: m.memberId,
      value: values.find((v) => v.memberId === m.memberId)?.value ?? null,
      assigned: !budgeted ? 0n : (amounts?.find((a) => a.memberId === m.memberId)?.amount ?? null),
    })),
    invalid: budgeted && !assigned.ok,
  };
};

const sumIn = <T extends { readonly currency: string; readonly amount: bigint }>(
  rows: readonly T[],
  currency: string,
): bigint => rows.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.amount, 0n);

const plus = (into: Map<string, bigint>, currency: string, amount: bigint) =>
  into.set(currency, (into.get(currency) ?? 0n) + amount);

/**
 * HU-E6-02 … HU-E6-05, HU-E6-09, spec 5.4: every figure of a plan for its current members (`memberIds`, join
 * order), derived on read (D7). available = planned + carry-over − spent; a line's carry-over follows its origin
 * line in `previousAvailable` (the figures of the plan it was copied from), by its own rollover mode (ruling P15),
 * and is 0 without one. Ruling P243 (M6c): a carry comes only from a CLOSED source, which `loadPlanView` enforces by
 * what it passes as `previousAvailable`; `source` only names where a carrying line's amount comes from, or waits for.
 * Ruling P342 (S7): every figure per currency, never converted: a movement counts only against a budget in its own
 * currency, a rollover mode applies to each currency's available, and the scalar figures are the space currency's
 * (`currency`).
 */
export const planFigures = (input: {
  readonly currency: string;
  readonly memberIds: readonly string[];
  readonly parts: PlanParts;
  readonly spending: PeriodSpending;
  readonly previousAvailable?: readonly PreviousAvailable[];
  readonly source?: CarrySource | null;
}): PlanFigures => {
  const { currency, memberIds, parts, spending, previousAvailable = [], source = null } = input;
  const spentOn = new Map<string | null, Map<string, bigint>>();
  for (const { categoryId, currency: spentIn, amount } of spending.byCategory) {
    const lineId = lineForCategory(categoryId, parts);
    const sums = spentOn.get(lineId) ?? new Map<string, bigint>();
    spentOn.set(lineId, plus(sums, spentIn, amount));
  }
  const transfersInto = (accountIds: readonly string[]) => {
    const sums = new Map<string, bigint>();
    for (const row of spending.byAccount)
      if (accountIds.includes(row.accountId)) plus(sums, row.currency, row.amount);
    return sums;
  };
  const lines = parts.lines.map((line): LineFigure => {
    const spent =
      line.funding === "SAVINGS"
        ? transfersInto(line.savingsAccountIds)
        : (spentOn.get(line.id) ?? new Map<string, bigint>());
    // HU-E6-09: by the origin link only, never by name.
    const origin = previousAvailable.find((p) => p.lineId === line.originLineId);
    const carried = new Map<string, bigint>();
    for (const c of currencyOrder(
      null,
      line.budgets.map((b) => b.currency),
      origin?.available.map((a) => a.currency) ?? [],
    ))
      carried.set(
        c,
        carryOver(line.rolloverMode, origin === undefined ? null : amountIn(origin.available, c)),
      );
    // Ruling P243: the source is named only for a line that carries and was copied from a line the source holds.
    const from =
      source !== null &&
      line.rolloverMode !== "RESET" &&
      line.originLineId !== null &&
      source.lineIds.includes(line.originLineId)
        ? { planId: source.planId, period: source.period, closed: source.closed }
        : null;
    const others = [...spent.keys(), ...[...carried].filter(([, amount]) => amount !== 0n).map(([c]) => c)];
    const budgets = currencyOrder(
      null,
      line.budgets.map((b) => b.currency),
      others,
    ).map((c): LineCurrencyFigure => {
      const planned = amountIn(line.budgets, c);
      const spentIn = spent.get(c) ?? 0n;
      const carriedIn = carried.get(c) ?? 0n;
      return {
        currency: c,
        budgeted: holds(line.budgets, c),
        planned,
        capacityShareBasisPoints: shareOfTotal(planned, totalCapacity(parts.capacities, memberIds, c)),
        allocation: allocationIn(line, parts, memberIds, c),
        spent: spentIn,
        carryOver: carriedIn,
        available: planned + carriedIn - spentIn,
      };
    });
    const own = budgets.find((b) => b.currency === currency);
    const ownAllocation = own?.allocation ?? allocationIn(line, parts, memberIds, currency);
    return {
      line,
      categoryIds: parts.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId),
      capacityShareBasisPoints: shareOfTotal(
        amountIn(line.budgets, currency),
        totalCapacity(parts.capacities, memberIds, currency),
      ),
      allocation: {
        rule: line.allocationRule,
        members: ownAllocation.members,
        invalid: budgets.some((b) => b.allocation.invalid),
      },
      planned: amountIn(line.budgets, currency),
      spent: own?.spent ?? 0n,
      carryOver: own?.carryOver ?? 0n,
      carryOverFrom: from,
      available: own?.available ?? 0n,
      budgets,
    };
  });
  const hasCatchAll = parts.lines.some((l) => l.isCatchAll);
  const unbudgeted = spentOn.get(null) ?? new Map<string, bigint>();
  const contributed = parts.capacities
    .filter((c) => memberIds.includes(c.memberId) && c.amount > 0n)
    .map((c) => c.currency);
  // Every currency a line plans, spent or carried in, so a sum over the lines in one currency is never left out.
  const planned = lines.flatMap((figure) => figure.budgets.map((b) => b.currency));
  const currencies = currencyOrder(currency, [], [...contributed, ...planned, ...unbudgeted.keys()]).map(
    (c): PlanCurrencyFigure => {
      const total = totalCapacity(parts.capacities, memberIds, c);
      const plannedIn = sumIn(
        parts.lines.flatMap((line) => line.budgets),
        c,
      );
      const spentIn = unbudgeted.get(c) ?? 0n;
      return {
        currency: c,
        capacities: withCapacities(parts.capacities, memberIds, c).map((m) => ({
          memberId: m.memberId,
          amount: m.capacity,
          shareBasisPoints: shareOfTotal(m.capacity, total),
        })),
        totalCapacity: total,
        planned: plannedIn,
        unallocated: total - plannedIn,
        unbudgeted: hasCatchAll ? null : { spent: spentIn, available: -spentIn },
      };
    },
  );
  const own = currencies[0]!;
  return {
    capacities: own.capacities,
    totalCapacity: own.totalCapacity,
    planned: own.planned,
    unallocated: own.unallocated,
    lines,
    unbudgeted: own.unbudgeted,
    currencies,
  };
};

/**
 * HU-E6-07, spec 5.2: a plan is activated only while its lines fit its capacity (PlanExceedsCapacity, checked
 * first) and every allocation holds (InvalidAllocation, its `lineIds` naming every flagged line in plan order,
 * ruling P13). Neither depends on what was spent. Ruling P342 (S7): the capacity is checked in every currency, the
 * space's first, and PlanExceedsCapacity names the first currency whose "Por repartir" is below 0.
 */
export const activationCheck = (figures: Pick<PlanFigures, "currencies" | "lines">): Result<void> => {
  const short = figures.currencies.find((c) => c.unallocated < 0n);
  if (short !== undefined) return err(domainError("PlanExceedsCapacity", { currency: short.currency }));
  const lineIds = figures.lines.filter((l) => l.allocation.invalid).map((l) => l.line.id);
  return lineIds.length === 0 ? ok(undefined) : err(domainError("InvalidAllocation", { lineIds }));
};
