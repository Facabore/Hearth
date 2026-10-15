import type { LineAllocation } from "./allocation";
import type { BudgetLine, BudgetLineId, CategoryMapping } from "./budget-line";
import type { PlanParts } from "./plan-figures";

/** HU-E6-06: what a copy leaves out, as its answer lists it (ruling P11); former members' rows go unlisted. */
export interface CopyDrops {
  /** Mappings to categories that are archived or no longer in the space, by the copied line. */
  readonly mappings: readonly CategoryMapping[];
  /** Accounts a copied SAVINGS line no longer names because they no longer qualify (P10), by the copied line. */
  readonly savingsAccounts: readonly { readonly lineId: string; readonly accountId: string }[];
  /** SAVINGS lines not copied because none of their accounts still qualifies (P10), by the source line. */
  readonly lines: readonly { readonly originLineId: string; readonly name: string }[];
}

export interface CopyInput {
  /** The new plan. */
  readonly planId: string;
  readonly now: Date;
  /** The source plan's parts as committed: capacities, current lines, mappings and allocation values. */
  readonly source: PlanParts;
  /** Exactly one new id per source line, in the source's line order (`copiedParts` throws otherwise). */
  readonly lineIds: readonly BudgetLineId[];
  /** The space's current members in join order, registered and guests (D15). */
  readonly memberIds: readonly string[];
  /** The space's live categories, archived ones flagged. */
  readonly categories: readonly { readonly id: string; readonly archived: boolean }[];
  /** Of the accounts the source's SAVINGS lines name, those a copy may keep (P10). */
  readonly usableAccountIds: readonly string[];
}

/**
 * HU-E6-06: a deep clone of the source plan's parts with new ids. Each copied line keeps its name, planned amount,
 * funding, rollover mode, catch-all flag and allocation rule, links to its source line (`originLineId`, HU-E6-09)
 * and is created a millisecond after the one before, so readers list the copies in the source's order. Former
 * members' capacities and values, mappings to categories that are archived or gone, and accounts that no longer
 * qualify are left out, and a SAVINGS line left without accounts is not copied. Nothing is checked against
 * capacity: the copy is a DRAFT, and activation checks it (HU-E6-07). A `lineIds` list that is not one id per source
 * line is a programming error, not a domain outcome: it throws.
 */
export const copiedParts = (input: CopyInput): { parts: PlanParts; dropped: CopyDrops } => {
  if (input.lineIds.length !== input.source.lines.length) {
    throw new Error("copiedParts needs one new line id per source line");
  }
  const live = new Set(input.categories.filter((c) => !c.archived).map((c) => c.id));
  const current = new Set(input.memberIds);
  const lines: BudgetLine[] = [];
  const mappings: CategoryMapping[] = [];
  const allocations: LineAllocation[] = [];
  const droppedMappings: CategoryMapping[] = [];
  const droppedAccounts: { lineId: string; accountId: string }[] = [];
  const droppedLines: { originLineId: string; name: string }[] = [];
  input.source.lines.forEach((line, index) => {
    const id = input.lineIds[index]!;
    const kept = line.savingsAccountIds.filter((accountId) => input.usableAccountIds.includes(accountId));
    if (line.funding === "SAVINGS" && kept.length === 0) {
      droppedLines.push({ originLineId: line.id, name: line.name });
      return;
    }
    for (const accountId of line.savingsAccountIds.filter((a) => !kept.includes(a))) {
      droppedAccounts.push({ lineId: id, accountId });
    }
    lines.push({
      ...line,
      id,
      planId: input.planId,
      originLineId: line.id,
      savingsAccountIds: kept,
      createdAt: new Date(input.now.getTime() + lines.length),
    });
    for (const mapping of input.source.mappings.filter((m) => m.lineId === line.id)) {
      const copied = { lineId: id, categoryId: mapping.categoryId };
      (live.has(mapping.categoryId) ? mappings : droppedMappings).push(copied);
    }
    for (const value of input.source.allocations) {
      if (value.lineId === line.id && current.has(value.memberId)) {
        allocations.push({ lineId: id, memberId: value.memberId, value: value.value });
      }
    }
  });
  return {
    parts: {
      capacities: input.source.capacities.filter((c) => current.has(c.memberId)),
      lines,
      mappings,
      allocations,
    },
    dropped: { mappings: droppedMappings, savingsAccounts: droppedAccounts, lines: droppedLines },
  };
};
