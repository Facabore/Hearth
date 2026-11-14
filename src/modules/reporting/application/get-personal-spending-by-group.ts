import { domainError, err, ok, type Period, type Result } from "@/shared/kernel";
import { accountFlows } from "../domain/account-flows";
import { spendingTree, type SpendingTree } from "../domain/spending-by-group";
import type { AccountFigures, AccountMovements } from "./account-movements";
import type { CategoryTrees } from "./category-trees";
import { consumptionRows, personalScope, type PersonalDeps } from "./personal-scope";

/**
 * What the caller's breakdown reads: the unified view's ports, the category trees (HU-E7-06) and an account's
 * movements.
 */
export type PersonalSpendingByGroupDeps = PersonalDeps & {
  readonly trees: CategoryTrees;
  readonly accountMovements: AccountMovements;
};

/** HU-E7-06: the caller's consumption in a personal period by group, category and subcategory. */
export interface PersonalSpendingByGroup extends SpendingTree {
  /** The personal space's currency, every amount's; spaces in another currency are left out (D6, ruling P37). */
  readonly currency: string;
  /** The caller's personal-space period; shared expenses are placed in it by date (D11). */
  readonly period: Period;
  /** Ruling P327: with `accountId`, what the account moved in the period; the tree is then what it paid. */
  readonly account?: AccountFigures;
}

export type GetPersonalSpendingByGroup = (input: {
  readonly userId: string;
  readonly period: string;
  /** Ruling P327: one of the caller's own accounts, whose payments the breakdown counts instead of her shares. */
  readonly accountId?: string | undefined;
}) => Promise<Result<PersonalSpendingByGroup>>;

/**
 * HU-E7-06: the caller's consumption exactly as the unified view sums it (HU-E7-04: their shares in every space they
 * are or were a member of, their own member rows only), grouped by the trees as they are now: seeded groups and
 * categories merge across spaces by catalog key, custom ones stay with their space (rulings P76, P77). Ruling P327:
 * with `accountId`, one of the caller's own accounts, what that account paid in any of those spaces instead, merged
 * the same way, with how many expenses each node holds and what else the account moved.
 */
export const createGetPersonalSpendingByGroup =
  (deps: PersonalSpendingByGroupDeps): GetPersonalSpendingByGroup =>
  async ({ userId, period: label, accountId }) => {
    const scope = await personalScope(deps, userId, label);
    if (!scope.ok) return scope;
    const { personal, period, places } = scope.value;
    // Only an account of the caller's personal space is hers (HU-E2-01); any other is unknown to her.
    if (accountId !== undefined && (await deps.accountMovements.spaceOf(accountId)) !== personal.spaceId)
      return err(domainError("AccountNotFound"));
    const flows =
      accountId === undefined
        ? null
        : accountFlows(
            accountId,
            await deps.accountMovements.movementsOf(
              accountId,
              places.map((p) => p.spaceId),
              period.start,
              period.end,
            ),
          );
    const rows = flows === null ? await consumptionRows(deps, scope.value, period) : flows.paid;
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
      ...(flows === null || accountId === undefined
        ? {}
        : {
            account: {
              id: accountId,
              in: flows.in,
              out: flows.out,
              movedToOwnAccounts: flows.movedToOwnAccounts,
            },
          }),
    });
  };
