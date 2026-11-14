import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";

export type BudgetLineId = Id<"BudgetLine">;
export const FUNDINGS = ["DIRECT", "SHARED_FUND", "SAVINGS"] as const;
export type Funding = (typeof FUNDINGS)[number];
export const ROLLOVER_MODES = ["RESET", "ROLLOVER", "ADJUSTED"] as const;
export type RolloverMode = (typeof ROLLOVER_MODES)[number];
export const ALLOCATION_RULES = ["PROPORTIONAL", "PERCENT", "FIXED", "NONE"] as const;
export type AllocationRule = (typeof ALLOCATION_RULES)[number];
/** D26: the line's payers name who usually pays it for every period (copied with the plan) or for this one only. */
export const PAYERS_SCOPES = ["EVERY_PERIOD", "THIS_PERIOD"] as const;
export type PayersScope = (typeof PAYERS_SCOPES)[number];

/** Spec 5.2 BudgetLine: an envelope of a plan; its categories are CategoryMapping rows. */
export interface BudgetLine {
  readonly id: BudgetLineId;
  readonly planId: string;
  /** HU-E6-06, HU-E6-09: the line it was copied from, for rollover; null until plans are copied. */
  readonly originLineId: string | null;
  readonly name: string;
  /** Minor units of the space currency, positive. */
  readonly plannedAmount: bigint;
  readonly funding: Funding;
  /** SAVINGS lines only: their spending is the transfers into these accounts (spec 5.4). */
  readonly savingsAccountIds: readonly string[];
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
  /** HU-E6-05: one rule per line, PROPORTIONAL by default; PERCENT and FIXED keep member values, NONE none. */
  readonly allocationRule: AllocationRule;
  /** D26: the members who usually pay the line, in the order named; empty when nobody does. */
  readonly payerMemberIds: readonly string[];
  /** D26: null exactly when the line has no payers. */
  readonly payersScope: PayersScope | null;
  readonly createdAt: Date;
}

/** HU-E6-04: expenses in the category consume the line; one current line per category and plan. */
export interface CategoryMapping {
  readonly lineId: string;
  readonly categoryId: string;
}

/** What a request sets on a line. */
export interface LineFields {
  readonly name: string;
  readonly plannedAmount: bigint;
  readonly funding: Funding;
  readonly savingsAccountIds: readonly string[];
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
  readonly payerMemberIds: readonly string[];
  /** Null with payers means every period. */
  readonly payersScope: PayersScope | null;
}

/** The rest of the plan, as a line written into it sees it. */
export interface LineContext {
  /** The plan's other current lines. */
  readonly siblings: readonly BudgetLine[];
  /** HU-E6-02: Σ capacities of the current members. */
  readonly totalCapacity: bigint;
  /** Categories currently mapped to this line; 0 for a new line. */
  readonly mappedCategories: number;
  /** D26: the members who may be named payers: the current members who are not VIEWERs (P261), guests included. */
  readonly payerCandidateIds: readonly string[];
}

const MAX_NAME = 60;
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * D26: a line's payers are named once each, never on a SAVINGS line, and a scope needs payers (none defaults to every
 * period). A payer named anew is a current member who is not a VIEWER; one the line already named stays through
 * other edits even after leaving the space, like a SAVINGS line's accounts.
 */
const checkedPayers = (
  fields: LineFields,
  context: LineContext,
  already: readonly string[],
): Result<Pick<LineFields, "payerMemberIds" | "payersScope">> => {
  const payers = fields.payerMemberIds;
  if (payers.length === 0) {
    return fields.payersScope === null
      ? ok({ payerMemberIds: [], payersScope: null })
      : err(domainError("InvalidLinePayers", { reason: "scopeWithoutPayers" }));
  }
  if (fields.funding === "SAVINGS") return err(domainError("InvalidLinePayers", { reason: "savingsLine" }));
  if (new Set(payers).size !== payers.length) {
    return err(domainError("InvalidLinePayers", { reason: "duplicate" }));
  }
  if (payers.some((id) => !already.includes(id) && !context.payerCandidateIds.includes(id))) {
    return err(domainError("InvalidLinePayers", { reason: "notMember" }));
  }
  return ok({ payerMemberIds: [...payers], payersScope: fields.payersScope ?? "EVERY_PERIOD" });
};

const checked = (
  fields: LineFields,
  context: LineContext,
  previousPlanned: bigint | null,
  previousPayers: readonly string[] = [],
): Result<LineFields> => {
  const name = fields.name.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    return err(domainError("InvalidBudgetLineName", { length: name.length }));
  }
  if (fields.plannedAmount <= 0n) return err(domainError("InvalidPlannedAmount"));
  const savings = fields.funding === "SAVINGS";
  const accounts = fields.savingsAccountIds;
  if (savings && accounts.length === 0) return err(domainError("SavingsAccountRequired"));
  if (!savings && accounts.length > 0) {
    return err(domainError("InvalidSavingsAccount", { reason: "notSavingsLine" }));
  }
  if (new Set(accounts).size !== accounts.length) {
    return err(domainError("InvalidSavingsAccount", { reason: "duplicate" }));
  }
  // Spec 5.4: a SAVINGS line consumes transfers into its accounts, never expense categories.
  if (savings && (fields.isCatchAll || context.mappedCategories > 0)) {
    return err(domainError("SavingsLineNotMappable"));
  }
  const { siblings } = context;
  if (siblings.some((line) => sameName(line.name, name))) return err(domainError("BudgetLineNameTaken"));
  if (fields.isCatchAll && siblings.some((line) => line.isCatchAll)) {
    return err(domainError("CatchAllLineAlreadySet"));
  }
  if (accounts.some((id) => siblings.some((line) => line.savingsAccountIds.includes(id)))) {
    return err(domainError("SavingsAccountAlreadyUsed"));
  }
  // Spec 5.2: adding a line or increasing it never pushes Σ planned above total capacity; other edits may.
  const grows = previousPlanned === null || fields.plannedAmount > previousPlanned;
  const plannedElsewhere = siblings.reduce((sum, line) => sum + line.plannedAmount, 0n);
  if (grows && plannedElsewhere + fields.plannedAmount > context.totalCapacity) {
    return err(domainError("PlanExceedsCapacity"));
  }
  const payers = checkedPayers(fields, context, previousPayers);
  if (!payers.ok) return payers;
  return ok({ ...fields, name, ...payers.value });
};

/** HU-E6-03: a new line of the plan, PROPORTIONAL until it is allocated otherwise (HU-E6-05). */
export const newLine = (
  input: { id: BudgetLineId; planId: string; now: Date; fields: LineFields },
  context: LineContext,
): Result<BudgetLine> => {
  const fields = checked(input.fields, context, null);
  if (!fields.ok) return fields;
  return ok({
    id: input.id,
    planId: input.planId,
    originLineId: null,
    ...fields.value,
    allocationRule: "PROPORTIONAL",
    createdAt: input.now,
  });
};

/**
 * HU-E6-03, HU-E6-04: edits a line; its allocation rule stays, and a line that stops being SAVINGS drops its accounts.
 * D26: a line that becomes SAVINGS drops its payers, and payers left out of a change keep their scope.
 */
export const reviseLine = (
  line: BudgetLine,
  change: Partial<LineFields>,
  context: LineContext,
): Result<BudgetLine> => {
  const funding = change.funding ?? line.funding;
  const fields = checked(
    {
      name: change.name ?? line.name,
      plannedAmount: change.plannedAmount ?? line.plannedAmount,
      funding,
      savingsAccountIds: change.savingsAccountIds ?? (funding === "SAVINGS" ? line.savingsAccountIds : []),
      rolloverMode: change.rolloverMode ?? line.rolloverMode,
      isCatchAll: change.isCatchAll ?? line.isCatchAll,
      payerMemberIds: change.payerMemberIds ?? (funding === "SAVINGS" ? [] : line.payerMemberIds),
      payersScope:
        change.payersScope !== undefined
          ? change.payersScope
          : change.payerMemberIds?.length === 0 ||
              (change.payerMemberIds === undefined && funding === "SAVINGS")
            ? null
            : line.payersScope,
    },
    context,
    line.plannedAmount,
    line.payerMemberIds,
  );
  return fields.ok ? ok({ ...line, ...fields.value }) : fields;
};

/**
 * HU-E6-04: the categories the line maps once `categoryIds` replaces its set. The line's own mappings stay as they
 * are; a newly mapped category is a live category of the space (anything else is CategoryNotInSpace, so other
 * spaces' categories never leak), not archived and not mapped to another current line of the plan.
 */
export const checkedMapping = (
  line: Pick<BudgetLine, "id" | "funding">,
  categoryIds: readonly string[],
  context: {
    readonly categories: readonly {
      readonly id: string;
      readonly archived: boolean;
      readonly parentCategoryId?: string | null;
    }[];
    readonly mappings: readonly CategoryMapping[];
  },
): Result<string[]> => {
  const wanted = [...new Set(categoryIds)];
  if (wanted.length > 0 && line.funding === "SAVINGS") return err(domainError("SavingsLineNotMappable"));
  const own = new Set(context.mappings.filter((m) => m.lineId === line.id).map((m) => m.categoryId));
  for (const categoryId of wanted) {
    if (own.has(categoryId)) continue;
    const category = context.categories.find((c) => c.id === categoryId);
    if (category === undefined) return err(domainError("CategoryNotInSpace"));
    // HU-E3-04: only categories are mapped; a subcategory follows its parent (D20).
    if ((category.parentCategoryId ?? null) !== null) return err(domainError("SubcategoryNotMappable"));
    if (category.archived) return err(domainError("CategoryArchived"));
    if (context.mappings.some((m) => m.categoryId === categoryId))
      return err(domainError("CategoryAlreadyMapped"));
  }
  return ok(wanted);
};
