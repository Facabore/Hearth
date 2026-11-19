import type { CurrencyNet } from "./get-space-balances";

/** Ruling P342 (S6): an amount in one currency, in its minor units. */
export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: bigint;
}

/**
 * Ruling P342 (S6): amounts added up in one currency for display only, never stored; a part whose currency has no rate
 * today has a null value and is not in `total`.
 */
export interface ApproximateTotal {
  readonly currency: string;
  readonly total: bigint;
  readonly parts: readonly (CurrencyAmount & { readonly value: bigint | null })[];
}

/**
 * Ruling P342 (S6): `amounts` approximately in the person's currency (their display currency, else their personal
 * space's) at today's rate; null without one. Bound by the composition root to reporting's conversion; balances
 * converts nothing itself.
 */
export type ApproximateToday = (
  userId: string,
  amounts: readonly CurrencyAmount[],
) => Promise<ApproximateTotal | null>;

/** One side of Amigos' totals: its approximate sum, and the amounts with no rate today, listed apart. */
export interface ApproximateSide {
  readonly total: bigint;
  readonly unrated: readonly CurrencyAmount[];
}

/** Ruling P342 (S6, board "Amigos · una deuda por moneda"): "Te deben ≈ 2.085.000 COP · Debes ≈ 120.000 COP". */
export interface FriendsApproximate {
  readonly currency: string;
  readonly owedToYou: ApproximateSide;
  readonly youOwe: ApproximateSide;
}

export type ApproximateFriendTotals = (
  userId: string,
  friends: readonly { readonly nets: readonly CurrencyNet[] }[],
) => Promise<FriendsApproximate | null>;

export interface ApproximateFriendTotalsDeps {
  /** Left out, Amigos approximates nothing. */
  readonly approximate?: ApproximateToday;
}

const sideOf = (total: ApproximateTotal): ApproximateSide => ({
  total: total.total,
  unrated: total.parts
    .filter((part) => part.value === null)
    .map(({ currency, amount }) => ({ currency, amount })),
});

/**
 * Ruling P342 (S6): what everyone owes the viewer and what she owes, each added up approximately in her currency at
 * today's rate, for Amigos' header only. Each debt stays in its own currency (S4): this converts nothing that is
 * stored. Null when every debt is in one currency, so nothing changes then.
 */
export const createApproximateFriendTotals =
  (deps: ApproximateFriendTotalsDeps): ApproximateFriendTotals =>
  async (userId, friends) => {
    const nets = friends.flatMap((friend) => friend.nets).filter((n) => n.net !== 0n);
    if (deps.approximate === undefined || new Set(nets.map((n) => n.currency)).size < 2) return null;
    const side = (owed: boolean) =>
      nets
        .filter((n) => n.net > 0n === owed)
        .map((n) => ({ currency: n.currency, amount: n.net > 0n ? n.net : -n.net }));
    const [owedToYou, youOwe] = await Promise.all([
      deps.approximate(userId, side(true)),
      deps.approximate(userId, side(false)),
    ]);
    if (owedToYou === null || youOwe === null) return null;
    return { currency: owedToYou.currency, owedToYou: sideOf(owedToYou), youOwe: sideOf(youOwe) };
  };
