import { authorizeSpaceAction, type SpaceId } from "@/modules/spaces/application";
import { domainError, err, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import { assignedAmounts } from "../domain/allocation";
import { capacityOf } from "../domain/capacity";
import { lineForCategory } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";
import type { BudgetCategories } from "./ports";

/** The ledger's split methods, as a member picks them (spec 5.2 Share); BY_ALLOCATION only as the default. */
export const SPLIT_METHODS = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"] as const;
export type SplitMethodName = (typeof SPLIT_METHODS)[number];

/** HU-E6-08: an expense of the space in `categoryId` dated `date`, its amounts in `currency`. */
export interface ExpenseToSplit {
  readonly spaceId: SpaceId;
  readonly currency: string;
  readonly categoryId: string;
  readonly date: LocalDate;
}

export interface DefaultSplit {
  readonly method: "BY_ALLOCATION" | "EQUAL";
  /** The line of the ACTIVE plan covering the date that the category consumes; null without one. */
  readonly lineId: string | null;
  /** BY_ALLOCATION: the line's positive assigned amounts; EQUAL: 1 per current member. Join order. */
  readonly weights: readonly { readonly memberId: string; readonly weight: bigint }[];
}

/**
 * HU-E6-08, spec 5.3, D4: the default split of an expense. BY_ALLOCATION by the line the category consumes (its
 * mapped line, else the catch-all line, HU-E6-04) in the ACTIVE plan covering the date, weighted by the line's
 * assigned amounts for the current members, the positive ones only; EQUAL among every current member otherwise: no
 * plan, a DRAFT or CLOSED one, no line, a NONE line, or an allocation that does not hold (ruling P16). It authorizes
 * nothing: its callers have.
 */
export const defaultSplitOf = async (
  deps: Pick<BudgetingDeps, "members" | "plans">,
  expense: ExpenseToSplit,
): Promise<DefaultSplit> => {
  const members = await deps.members.listCurrent(expense.spaceId);
  const equal = (lineId: string | null): DefaultSplit => ({
    method: "EQUAL",
    lineId,
    weights: members.map((m) => ({ memberId: m.id, weight: 1n })),
  });
  const plan = await deps.plans.covering(expense.spaceId, expense.date);
  if (plan === null || plan.status !== "ACTIVE") return equal(null);
  const parts = await deps.plans.contents(plan.id);
  const lineId = lineForCategory(expense.categoryId, parts);
  const line = parts.lines.find((l) => l.id === lineId);
  if (line === undefined) return equal(null);
  const assigned = assignedAmounts(
    line,
    parts.allocations.filter((a) => a.lineId === line.id),
    members.map((m) => ({ memberId: m.id, capacity: capacityOf(parts.capacities, m.id) })),
    expense.currency,
  );
  const weights =
    assigned.ok && assigned.value !== null
      ? assigned.value.filter((a) => a.amount > 0n).map((a) => ({ memberId: a.memberId, weight: a.amount }))
      : [];
  return weights.length === 0 ? equal(line.id) : { method: "BY_ALLOCATION", lineId: line.id, weights };
};

export interface DefaultSplitView {
  readonly method: DefaultSplit["method"];
  /** What a member may pick; BY_ALLOCATION only when it is the default, since no client requests it (P16). */
  readonly availableMethods: readonly SplitMethodName[];
  readonly lineId: string | null;
  readonly currency: string;
  /** The amount shared by the default, in join order; null when no amount was given. */
  readonly shares: readonly { readonly memberId: string; readonly amount: bigint }[] | null;
}

export type ResolveDefaultSplit = (input: {
  spaceId: string;
  userId: string;
  categoryId: string;
  date: LocalDate;
  /** Minor units of the space currency. */
  amount: bigint | null;
}) => Promise<Result<DefaultSplitView>>;

export type DefaultSplitDeps = BudgetingDeps & { readonly categories: BudgetCategories };

/**
 * HU-E6-08 ResolveDefaultSplit, the public query behind GET …/default-split: any member previews the default split
 * of an expense in a live category of the space (archived ones included), and of an amount when given. A preview
 * records nothing, so it is space.read and archived spaces answer it too.
 */
export const createResolveDefaultSplit =
  (deps: DefaultSplitDeps): ResolveDefaultSplit =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    // P6: any id that is not a live category of this space, unknown ones included, answers the same.
    const categories = await deps.categories.list(space.spaceId);
    if (!categories.some((c) => c.id === input.categoryId)) return err(domainError("CategoryNotInSpace"));
    const split = await defaultSplitOf(deps, {
      spaceId: space.spaceId,
      currency: space.currency,
      categoryId: input.categoryId,
      date: input.date,
    });
    let shares: { memberId: string; amount: bigint }[] | null = null;
    if (input.amount !== null) {
      const total = Money.ofMinor(input.amount, space.currency);
      if (!total.ok) return total;
      const parts = total.value.allocate(split.weights.map((w) => w.weight));
      if (!parts.ok) return parts;
      shares = split.weights.map((w, index) => ({ memberId: w.memberId, amount: parts.value[index]!.minor }));
    }
    return ok({
      method: split.method,
      availableMethods: SPLIT_METHODS.filter(
        (m) => m !== "BY_ALLOCATION" || split.method === "BY_ALLOCATION",
      ),
      lineId: split.lineId,
      currency: space.currency,
      shares,
    });
  };
