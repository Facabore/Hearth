import { domainError, err, ok, type Period, type Result } from "@/shared/kernel";
import { accountFlows } from "../domain/account-flows";
import { spendingTree, type SpendingTree } from "../domain/spending-by-group";
import type { AccountFigures, AccountMovements } from "./account-movements";
import type { CategoryTrees } from "./category-trees";
import type { ReportingDeps } from "./deps";
import { spacePeriod, type SpaceReportInput } from "./space-report";

/** What a space's breakdown reads: the space reports' ports, the category tree (HU-E7-06) and an account's movements. */
export type SpendingByGroupDeps = ReportingDeps & {
  readonly trees: CategoryTrees;
  readonly accountMovements: AccountMovements;
};

/** HU-E7-06: a space's spending in a period by group, category and subcategory. */
export interface SpendingByGroup extends SpendingTree {
  readonly spaceId: string;
  readonly currency: string;
  readonly period: Period;
  /** Ruling P327: with `accountId`, what the account moved in the period; the tree is then what it paid. */
  readonly account?: AccountFigures;
}

/** Ruling P327: `accountId` narrows the breakdown to what one of the space's accounts paid. */
export interface SpendingByGroupInput extends SpaceReportInput {
  readonly accountId?: string | undefined;
}

export type GetSpendingByGroup = (input: SpendingByGroupInput) => Promise<Result<SpendingByGroup>>;

/**
 * HU-E7-06: the amount of every live expense of the space dated in the period, whoever paid it and from whichever
 * account (an expense paid from the fund counts once), placed in the space's tree as it is now (ruling P80); every
 * node is the space's own, so nothing merges. Ruling P327: with `accountId`, only what that account of the space paid,
 * with how many expenses each node holds and what else the account moved. Computed on read (D7).
 */
export const createGetSpendingByGroup =
  (deps: SpendingByGroupDeps): GetSpendingByGroup =>
  async (input) => {
    const scoped = await spacePeriod(deps, input);
    if (!scoped.ok) return scoped;
    const { space, period } = scoped.value;
    const report = { spaceId: space.spaceId, currency: space.currency, period };
    if (input.accountId !== undefined) {
      // Only an account of this space, archived ones included; any other is unknown here.
      if ((await deps.accountMovements.spaceOf(input.accountId)) !== space.spaceId)
        return err(domainError("AccountNotFound"));
      const flows = accountFlows(
        input.accountId,
        await deps.accountMovements.movementsOf(input.accountId, [space.spaceId], period.start, period.end),
      );
      return ok({
        ...report,
        ...spendingTree(flows.paid, await deps.trees.treesOf([space.spaceId]), { kind: "SPACE" }),
        account: {
          id: input.accountId,
          in: flows.in,
          out: flows.out,
          movedToOwnAccounts: flows.movedToOwnAccounts,
        },
      });
    }
    const spent = await deps.spending.expensesByCategory(space.spaceId, period.start, period.end);
    const rows = spent.map((row) => ({
      spaceId: space.spaceId,
      categoryId: row.categoryId,
      amount: row.amount,
    }));
    const tree = await deps.trees.treesOf([space.spaceId]);
    return ok({ ...report, ...spendingTree(rows, tree, { kind: "SPACE" }) });
  };
