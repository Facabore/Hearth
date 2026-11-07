import { ok, type Period, type Result } from "@/shared/kernel";
import type { PaletteKey } from "@/shared/kernel/style";
import { cashOutOf, consumptionGroups, type CashOut } from "../domain/unified-view";
import { consumptionRows, personalScope, type PersonalDeps } from "./personal-scope";

/** One group of the caller's consumption: a catalog key, or a custom category with its space ("space / category"). */
export interface UnifiedGroup {
  readonly key: string | null;
  /** A merged group's name in the personal space, else in the space spending most in it (ruling P76). */
  readonly name: string;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly category: { readonly id: string; readonly name: string } | null;
  readonly amount: bigint;
  /** #240 (board E9-11 01): the spaces the row's consumption came from, the personal space first. */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
}

/** Ruling P306: the caller's consumption and what they paid in one space, for Inicio's breakdown. */
export interface SpaceFigures {
  readonly space: {
    readonly id: string;
    readonly name: string;
    readonly kind: "PERSONAL" | "SHARED" | "DIRECT";
    readonly color: PaletteKey;
  };
  /** Σ the caller's shares of the space's live expenses in the period. */
  readonly consumed: bigint;
  /** Σ the caller's payments of the space's expenses and fund contributions in the period (spec 5.4). */
  readonly paid: bigint;
}

export interface UnifiedPersonalView {
  /** The personal space's currency, every amount's (D6). */
  readonly currency: string;
  /** The caller's personal-space period; shared transactions are placed in it by date (D11). */
  readonly period: Period;
  readonly consumption: { readonly total: bigint; readonly groups: readonly UnifiedGroup[] };
  readonly cashOut: CashOut;
  /**
   * Ruling P306: the figures per space, the personal one first and then every other space with consumption or payments
   * in the period; Σ consumed is the consumption's total. Savings transfers are no space's, so Σ paid leaves them out.
   */
  readonly bySpace: readonly SpaceFigures[];
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
    const rows = await consumptionRows(deps, scope.value, period);
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
    // Ruling P306: one read per space, over every member row of the caller there (a former one included).
    const spacesOf = [...new Map(places.map((p) => [p.spaceId as string, p])).values()];
    const bySpace = await Promise.all(
      spacesOf.map(async (place): Promise<SpaceFigures> => {
        const rowsIn = places.filter((p) => p.spaceId === place.spaceId).map((p) => p.memberId);
        const out = await deps.sums.cashOut(rowsIn, period.start, period.end);
        return {
          space: { id: place.spaceId, name: place.spaceName, kind: place.spaceKind, color: place.color },
          consumed: rows.filter((r) => r.spaceId === place.spaceId).reduce((sum, r) => sum + r.amount, 0n),
          paid: out.payments + out.fundContributions,
        };
      }),
    );
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
            spaces: g.spaceIds.map((id) => ({ id, name: spaceNames.get(id) ?? "" })),
          }),
        ),
      },
      cashOut: cashOutOf(
        paidOut,
        transfers.reduce((sum, t) => sum + t.amount, 0n),
      ),
      bySpace: bySpace.filter((s) => s.space.id === personal.spaceId || s.consumed !== 0n || s.paid !== 0n),
      otherCurrencySpaces: [...others.values()].map((p) => ({
        spaceId: p.spaceId,
        name: p.spaceName,
        currency: p.currency,
      })),
    });
  };
