import { ok, type Period, type Result } from "@/shared/kernel";
import { spendingTree, type SpendingTree } from "../domain/spending-by-group";
import type { CategoryTrees } from "./category-trees";
import { consumptionRows, personalScope, type PersonalDeps } from "./personal-scope";

/** What the caller's breakdown reads: the unified view's ports and the category trees (HU-E7-06). */
export type PersonalSpendingByGroupDeps = PersonalDeps & { readonly trees: CategoryTrees };

/** HU-E7-06: the caller's consumption in a personal period by group, category and subcategory. */
export interface PersonalSpendingByGroup extends SpendingTree {
  /** The personal space's currency, every amount's; spaces in another currency are left out (D6, ruling P37). */
  readonly currency: string;
  /** The caller's personal-space period; shared expenses are placed in it by date (D11). */
  readonly period: Period;
}

export type GetPersonalSpendingByGroup = (input: {
  readonly userId: string;
  readonly period: string;
}) => Promise<Result<PersonalSpendingByGroup>>;

/**
 * HU-E7-06: the caller's consumption exactly as the unified view sums it (HU-E7-04: their shares in every space they
 * are or were a member of, their own member rows only), grouped by the trees as they are now: seeded groups and
 * categories merge across spaces by catalog key, custom ones stay with their space (rulings P76, P77).
 */
export const createGetPersonalSpendingByGroup =
  (deps: PersonalSpendingByGroupDeps): GetPersonalSpendingByGroup =>
  async ({ userId, period: label }) => {
    const scope = await personalScope(deps, userId, label);
    if (!scope.ok) return scope;
    const { personal, period, places } = scope.value;
    const rows = await consumptionRows(deps, scope.value, period);
    // The personal space's tree names the merged rows, even where it has no spending (ruling P76).
    const tree = await deps.trees.treesOf([
      ...new Set<string>([personal.spaceId, ...rows.map((row) => row.spaceId)]),
    ]);
    const personalGroups = await deps.trees.groupsOf([personal.spaceId]);
    const spaceNames = new Map(places.map((p) => [p.spaceId as string, p.spaceName]));
    return ok({
      currency: personal.currency,
      period,
      ...spendingTree(rows, tree, {
        kind: "PERSONAL",
        personalSpaceId: personal.spaceId,
        spaceNames,
        personalGroups,
      }),
    });
  };
