import { authorizeSpaceAction, type SpaceId } from "@/modules/spaces/application";
import {
  defaultSplitMembers,
  domainError,
  err,
  flatMap,
  map,
  Money,
  ok,
  positiveShares,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import { rolledUpCategory, type CategoryParent } from "../domain/category-rollup";
import { lineAssignment, lineForCategory } from "../domain/plan-figures";
import type { BudgetingDeps } from "./deps";

/** The ledger's split methods, as a member picks them (spec 5.2 Share); BY_ALLOCATION only as the default. */
export const SPLIT_METHODS = ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"] as const;
export type SplitMethodName = (typeof SPLIT_METHODS)[number];

/** HU-E6-08: an expense of the space in `categoryId` dated `date`, its amounts in `currency`. */
export interface ExpenseToSplit {
  readonly spaceId: SpaceId;
  readonly currency: string;
  readonly categoryId: string;
  readonly date: LocalDate;
  /**
   * The space's current members in join order but its VIEWERs, as the caller read them: the only members the split
   * may name (ruling P293).
   */
  readonly memberIds: readonly string[];
  /**
   * The space's current VIEWERs, read with `memberIds`. Ruling P293: they never take part in the default, but a
   * capacity or a value stored before they became VIEWERs still makes the line's allocation hold (P263).
   */
  readonly viewerIds: readonly string[];
}

export interface DefaultSplit {
  readonly method: "BY_ALLOCATION" | "EQUAL";
  /** The line of the ACTIVE plan covering the date that the category consumes; null without one. */
  readonly lineId: string | null;
  /** BY_ALLOCATION: the line's positive assigned amounts; EQUAL: 1 per member of `memberIds`. Join order. */
  readonly weights: readonly { readonly memberId: string; readonly weight: bigint }[];
}

/**
 * HU-E6-08, spec 5.3, D4: the default split of an expense. BY_ALLOCATION by the line the category consumes (its
 * mapped line, else the catch-all line, HU-E6-04) in the ACTIVE plan covering the date, weighted by the line's
 * assigned amounts for the expense's `memberIds`, the positive ones only; EQUAL among them otherwise: no plan, a
 * DRAFT or CLOSED one, no line, a NONE line, or an allocation that does not hold (ruling P16). The caller read those
 * ids (the space's current members but its VIEWERs, `defaultSplitMembers`) and nobody else is ever named; ruling
 * P293: a VIEWER's stored figures still count when the line's allocation is judged, never as a weight. It authorizes
 * nothing: its callers have.
 * HU-E3-04: an expense in a subcategory follows its parent's line, by the space's categories; a caller that read
 * them passes them as `categories`, and without them they are read here once, when a plan applies.
 */
export const defaultSplitOf = async (
  deps: Pick<BudgetingDeps, "plans" | "categories">,
  expense: ExpenseToSplit,
  categories?: readonly CategoryParent[],
): Promise<DefaultSplit> => {
  const equal = (lineId: string | null): DefaultSplit => ({
    method: "EQUAL",
    lineId,
    weights: expense.memberIds.map((memberId) => ({ memberId, weight: 1n })),
  });
  const plan = await deps.plans.covering(expense.spaceId, expense.date);
  if (plan === null || plan.status !== "ACTIVE") return equal(null);
  const parts = await deps.plans.contents(plan.id);
  const categoryId = rolledUpCategory(
    expense.categoryId,
    categories ?? (await deps.categories.list(expense.spaceId)),
  );
  const lineId = lineForCategory(categoryId, parts);
  const line = parts.lines.find((l) => l.id === lineId);
  if (line === undefined) return equal(null);
  // P293: the line is assigned among every current member, so a VIEWER's stored figures keep it holding (P263), and
  // only then are the VIEWERs left out of the weights.
  const current = [...expense.memberIds, ...expense.viewerIds];
  const { assigned } = lineAssignment(line, parts, current, expense.currency);
  const weights =
    assigned.ok && assigned.value !== null
      ? assigned.value
          .filter((a) => a.amount > 0n && expense.memberIds.includes(a.memberId))
          .map((a) => ({ memberId: a.memberId, weight: a.amount }))
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

/**
 * HU-E6-08 ResolveDefaultSplit, the public query behind GET …/default-split: any member previews the default split
 * of an expense in a live category of the space (archived ones included), and of an amount when given. A preview
 * records nothing, so it is space.read and archived spaces answer it too. Ruling P285: an amount too small to give
 * every member of the default a positive share answers InvalidSplit, as recording that expense would.
 */
export const createResolveDefaultSplit =
  (deps: BudgetingDeps): ResolveDefaultSplit =>
  async (input) => {
    const reader = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    // P6: any id that is not a live category of this space, unknown ones included, answers the same.
    const categories = await deps.categories.list(space.spaceId);
    if (!categories.some((c) => c.id === input.categoryId)) return err(domainError("CategoryNotInSpace"));
    const members = await deps.members.listCurrent(space.spaceId);
    const split = await defaultSplitOf(
      deps,
      {
        spaceId: space.spaceId,
        currency: space.currency,
        categoryId: input.categoryId,
        date: input.date,
        ...defaultSplitMembers(members),
      },
      categories,
    );
    let shares: { memberId: string; amount: bigint }[] | null = null;
    if (input.amount !== null) {
      const total = Money.ofMinor(input.amount, space.currency);
      if (!total.ok) return total;
      // Ruling P285: an amount too small to give everyone a positive share answers the InvalidSplit recording would.
      const parts = flatMap(
        map(total.value.allocate(split.weights.map((w) => w.weight)), (allocated) =>
          allocated.map((p) => p.minor),
        ),
        positiveShares,
      );
      if (!parts.ok) return parts;
      shares = split.weights.map((w, index) => ({ memberId: w.memberId, amount: parts.value[index]! }));
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
