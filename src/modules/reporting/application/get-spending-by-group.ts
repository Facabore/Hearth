import { ok, type Period, type Result } from "@/shared/kernel";
import { spendingTree, type SpendingTree } from "../domain/spending-by-group";
import type { CategoryTrees } from "./category-trees";
import type { ReportingDeps } from "./deps";
import { spacePeriod, type SpaceReportInput } from "./space-report";

/** What a space's breakdown reads: the space reports' ports and the category tree (HU-E7-06). */
export type SpendingByGroupDeps = ReportingDeps & { readonly trees: CategoryTrees };

/** HU-E7-06: a space's spending in a period by group, category and subcategory. */
export interface SpendingByGroup extends SpendingTree {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
}

export type GetSpendingByGroup = (input: SpaceReportInput) => Promise<Result<SpendingByGroup>>;

/**
 * HU-E7-06: the amount of every live expense of the space dated in the period, whoever paid it and from whichever
 * account (an expense paid from the fund counts once), placed in the space's tree as it is now (ruling P80); every
 * node is the space's own, so nothing merges. Computed on read (D7).
 */
export const createGetSpendingByGroup =
  (deps: SpendingByGroupDeps): GetSpendingByGroup =>
  async (input) => {
    const scoped = await spacePeriod(deps, input);
    if (!scoped.ok) return scoped;
    const { space, period } = scoped.value;
    const spent = await deps.spending.expensesByCategory(space.spaceId, period.start, period.end);
    const rows = spent.map((row) => ({
      spaceId: space.spaceId,
      categoryId: row.categoryId,
      amount: row.amount,
    }));
    const tree = await deps.trees.treesOf([space.spaceId]);
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      period,
      ...spendingTree(rows, tree, { kind: "SPACE" }),
    });
  };
