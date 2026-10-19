import { ok, type Period, type Result } from "@/shared/kernel";
import { cashOutOf, consumptionGroups, type CashOut } from "../domain/unified-view";
import { personalScope, type PersonalDeps } from "./personal-scope";

/** One group of the caller's consumption: a catalog key, or a custom category with its space ("space / category"). */
export interface UnifiedGroup {
  readonly key: string | null;
  /** A merged group's name in the personal space, else in the space spending most in it (ruling P76). */
  readonly name: string;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly category: { readonly id: string; readonly name: string | null } | null;
  readonly amount: bigint;
}

export interface UnifiedPersonalView {
  /** The personal space's currency, every amount's (D6). */
  readonly currency: string;
  /** The caller's personal-space period; shared transactions are placed in it by date (D11). */
  readonly period: Period;
  readonly consumption: { readonly total: bigint; readonly groups: readonly UnifiedGroup[] };
  readonly cashOut: CashOut;
  /** Spaces in another currency, left out of every sum, each named once (ruling P37). */
  readonly otherCurrencySpaces: readonly {
    readonly spaceId: string;
    readonly name: string;
    readonly currency: string;
  }[];
}

export type GetUnifiedPersonalView = (input: {
  readonly userId: string;
  readonly period: string;
}) => Promise<Result<UnifiedPersonalView>>;

/**
 * HU-E7-04, spec 5.4, D11: everything the caller consumed in a personal period (their shares in every space they are
 * or were a member of, the history of a claimed guest place included) and their cash out, computed on read (D7).
 */
export const createGetUnifiedPersonalView =
  (deps: PersonalDeps): GetUnifiedPersonalView =>
  async ({ userId, period: label }) => {
    const scope = await personalScope(deps, userId, label);
    if (!scope.ok) return scope;
    const { personal, period, places, otherCurrencies } = scope.value;
    const memberIds = places.map((p) => p.memberId);
    const rows = await deps.sums.consumptionByCategory(memberIds, period.start, period.end);
    // The personal space's categories name the merged groups, even without consumption there (ruling P76).
    const spaceIds = [...new Set<string>([personal.spaceId, ...rows.map((row) => row.spaceId)])];
    const listed = await Promise.all(
      spaceIds.map(async (spaceId) =>
        (await deps.catalog.listCategories(spaceId)).map((c) => ({ ...c, spaceId })),
      ),
    );
    const categories = listed.flat();
    const spaceNames = new Map(places.map((p) => [p.spaceId as string, p.spaceName]));
    const savings = await deps.savingsAccountsOf(userId);
    const transfers =
      savings.length === 0
        ? []
        : await deps.spending.transfersIntoAccounts(savings, period.start, period.end);
    const paidOut = await deps.sums.cashOut(memberIds, period.start, period.end);
    const others = new Map(otherCurrencies.map((p) => [p.spaceId as string, p]));
    return ok({
      currency: personal.currency,
      period,
      consumption: {
        total: rows.reduce((sum, row) => sum + row.amount, 0n),
        groups: consumptionGroups(rows, categories, { personalSpaceId: personal.spaceId, spaceNames }).map(
          (g) => ({
            key: g.key,
            name: g.name,
            space: g.spaceId === null ? null : { id: g.spaceId, name: spaceNames.get(g.spaceId) ?? "" },
            category: g.categoryId === null ? null : { id: g.categoryId, name: g.name },
            amount: g.amount,
          }),
        ),
      },
      cashOut: cashOutOf(
        paidOut,
        transfers.reduce((sum, t) => sum + t.amount, 0n),
      ),
      otherCurrencySpaces: [...others.values()].map((p) => ({
        spaceId: p.spaceId,
        name: p.spaceName,
        currency: p.currency,
      })),
    });
  };
