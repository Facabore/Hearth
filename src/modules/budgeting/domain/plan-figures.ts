import { domainError, err, ok, type Result } from "@/shared/kernel";
import { assignedAmounts, type LineAllocation } from "./allocation";
import type { AllocationRule, BudgetLine, CategoryMapping } from "./budget-line";
import { capacityOf, shareOfTotal, totalCapacity, type MemberCapacity } from "./capacity";

/** What a plan holds: its capacities, current lines, current category mappings and current allocation values. */
export interface PlanParts {
  readonly capacities: readonly MemberCapacity[];
  readonly lines: readonly BudgetLine[];
  readonly mappings: readonly CategoryMapping[];
  readonly allocations: readonly LineAllocation[];
}

/** Spec 5.4: what was spent in the plan's period, summed by the ledger on read (D7). */
export interface PeriodSpending {
  /** Σ live expenses of the plan's space per category. */
  readonly byCategory: readonly { readonly categoryId: string; readonly amount: bigint }[];
  /** Σ live transfers into each account that a SAVINGS line names. */
  readonly byAccount: readonly { readonly accountId: string; readonly amount: bigint }[];
}

export interface CapacityFigure {
  readonly memberId: string;
  readonly amount: bigint;
  /** Basis points of total capacity (40.00 % = 4000); null without capacity. */
  readonly shareBasisPoints: number | null;
}

export interface AllocationFigure {
  readonly rule: AllocationRule;
  /** Every current member in join order; none on a NONE line. */
  readonly members: readonly {
    readonly memberId: string;
    /** The stored PERCENT basis points or FIXED minor units; null for PROPORTIONAL and members without one. */
    readonly value: bigint | null;
    /** Null on an invalid allocation. */
    readonly assigned: bigint | null;
  }[];
  /** HU-E6-05: InvalidAllocation, until the line is allocated again. */
  readonly invalid: boolean;
}

export interface LineFigure {
  readonly line: BudgetLine;
  readonly categoryIds: readonly string[];
  readonly capacityShareBasisPoints: number | null;
  readonly allocation: AllocationFigure;
  readonly spent: bigint;
  readonly available: bigint;
}

export interface PlanFigures {
  readonly capacities: readonly CapacityFigure[];
  readonly totalCapacity: bigint;
  readonly planned: bigint;
  /** Total capacity − Σ planned; negative once capacities were reduced below the lines (HU-E6-02). */
  readonly unallocated: bigint;
  readonly lines: readonly LineFigure[];
  /** HU-E6-04: the implicit line of unmapped spending; null when the plan has a catch-all line. */
  readonly unbudgeted: { readonly spent: bigint; readonly available: bigint } | null;
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

const allocationFigure = (
  line: BudgetLine,
  allocations: readonly LineAllocation[],
  members: readonly { readonly memberId: string; readonly capacity: bigint }[],
  currency: string,
): AllocationFigure => {
  if (line.allocationRule === "NONE") return { rule: "NONE", members: [], invalid: false };
  const values = allocations.filter((a) => a.lineId === line.id);
  const assigned = assignedAmounts(line, values, members, currency);
  const amounts = assigned.ok ? assigned.value : null;
  return {
    rule: line.allocationRule,
    members: members.map((m) => ({
      memberId: m.memberId,
      value: values.find((v) => v.memberId === m.memberId)?.value ?? null,
      assigned: amounts?.find((a) => a.memberId === m.memberId)?.amount ?? null,
    })),
    invalid: !assigned.ok,
  };
};

/**
 * HU-E6-02 … HU-E6-05, spec 5.4: every figure of a plan for its current members (`memberIds`, join order),
 * derived on read (D7). available = planned + carry-over − spent, and the carry-over is 0 until lines have an
 * origin (HU-E6-06, HU-E6-09).
 */
export const planFigures = (input: {
  readonly currency: string;
  readonly memberIds: readonly string[];
  readonly parts: PlanParts;
  readonly spending: PeriodSpending;
}): PlanFigures => {
  const { currency, memberIds, parts, spending } = input;
  const total = totalCapacity(parts.capacities, memberIds);
  const members = memberIds.map((memberId) => ({
    memberId,
    capacity: capacityOf(parts.capacities, memberId),
  }));
  const spentOn = new Map<string | null, bigint>();
  for (const { categoryId, amount } of spending.byCategory) {
    const lineId = lineForCategory(categoryId, parts);
    spentOn.set(lineId, (spentOn.get(lineId) ?? 0n) + amount);
  }
  const transfersInto = (accountIds: readonly string[]) =>
    spending.byAccount.filter((a) => accountIds.includes(a.accountId)).reduce((sum, a) => sum + a.amount, 0n);
  const lines = parts.lines.map((line): LineFigure => {
    const spent =
      line.funding === "SAVINGS" ? transfersInto(line.savingsAccountIds) : (spentOn.get(line.id) ?? 0n);
    return {
      line,
      categoryIds: parts.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId),
      capacityShareBasisPoints: shareOfTotal(line.plannedAmount, total),
      allocation: allocationFigure(line, parts.allocations, members, currency),
      spent,
      available: line.plannedAmount - spent,
    };
  });
  const planned = parts.lines.reduce((sum, line) => sum + line.plannedAmount, 0n);
  const unbudgeted = spentOn.get(null) ?? 0n;
  return {
    capacities: members.map((m) => ({
      memberId: m.memberId,
      amount: m.capacity,
      shareBasisPoints: shareOfTotal(m.capacity, total),
    })),
    totalCapacity: total,
    planned,
    unallocated: total - planned,
    lines,
    unbudgeted: parts.lines.some((l) => l.isCatchAll) ? null : { spent: unbudgeted, available: -unbudgeted },
  };
};

/**
 * HU-E6-07, spec 5.2: a plan is activated only while its lines fit its capacity (PlanExceedsCapacity, checked
 * first) and every allocation holds (InvalidAllocation, its `lineIds` naming every flagged line in plan order,
 * ruling P13). Neither depends on what was spent.
 */
export const activationCheck = (figures: Pick<PlanFigures, "unallocated" | "lines">): Result<void> => {
  if (figures.unallocated < 0n) return err(domainError("PlanExceedsCapacity"));
  const lineIds = figures.lines.filter((l) => l.allocation.invalid).map((l) => l.line.id);
  return lineIds.length === 0 ? ok(undefined) : err(domainError("InvalidAllocation", { lineIds }));
};
