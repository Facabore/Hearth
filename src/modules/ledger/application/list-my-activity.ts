import type { MemberPlaceRepository, SpaceRepository } from "@/modules/spaces/application";
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
import type { Transaction } from "../domain/transaction";
import {
  describeActivity,
  type ActivityCategories,
  type ActivityItem,
  type MemberNames,
  type SettlementContextSource,
} from "./activity-description";

export type {
  ActivityCategories,
  ActivityItem,
  MemberNames,
  SettlementContext,
  SettlementContextSource,
} from "./activity-description";

export interface RecentQuery {
  readonly spaceIds: readonly string[];
  readonly from: LocalDate;
  /** Ruling P310: the last date listed, when given. */
  readonly to?: LocalDate | undefined;
  /** Ruling P329: only the movements that involve one of these member rows (`Involving`). */
  readonly involving: readonly string[];
}

/**
 * Ruling P306: the live transactions of `spaceIds` dated `from` or later (and `to` or earlier, ruling P310, when given)
 * that involve the person (ruling P329), newest first as Movimientos orders them.
 */
export interface RecentTransactions {
  recentIn(query: RecentQuery, limit: number): Promise<Transaction[]>;
}

export interface MyActivityDeps {
  /** The caller's current spaces, archived ones left out. */
  readonly spaces: Pick<SpaceRepository, "listForUser">;
  /** The caller's member rows, former ones and a claimed guest's included: what is theirs in each space. */
  readonly places: MemberPlaceRepository;
  readonly members: MemberNames;
  readonly recent: RecentTransactions;
  readonly categories: ActivityCategories;
  /** Ruling P339: whether each payment between the caller and someone else paid or lent. */
  readonly settlements?: SettlementContextSource;
}

export type ListMyActivity = (input: {
  readonly userId: string;
  readonly from: LocalDate;
  /** Ruling P310: the last date listed, a past period's end. */
  readonly to?: LocalDate;
  readonly limit: number;
}) => Promise<Result<readonly ActivityItem[]>>;

export const MAX_ACTIVITY = 50;

/**
 * Ruling P306 (#268): what happened lately in the caller's shared and direct spaces, for the personal Inicio's feed.
 * Only spaces the caller currently belongs to, never a personal one (theirs is read as Movimientos reads it, and no one
 * else's is ever reachable), newest first, from `from`. Ruling P329: only what involves the caller, by any of their
 * member rows; the rest stays in its space's own Movimientos. Each movement says its space, who recorded it, and the
 * caller's part of it (`describeActivity`).
 */
export const createListMyActivity =
  (deps: MyActivityDeps): ListMyActivity =>
  async ({ userId, from, to, limit }) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ACTIVITY)
      return err(domainError("InvalidActivityLimit", { max: MAX_ACTIVITY }));
    // Ruling P310: a range that ends before it starts holds nothing.
    if (to !== undefined && to < from) return ok([]);
    const [current, places] = await Promise.all([
      deps.spaces.listForUser(userId),
      deps.places.placesOf(userId),
    ]);
    const spaces = current.filter((s) => s.kind !== "PERSONAL");
    if (spaces.length === 0) return ok([]);
    const transactions = await deps.recent.recentIn(
      { spaceIds: spaces.map((s) => s.id), from, to, involving: places.map((p) => p.memberId as string) },
      limit,
    );
    if (transactions.length === 0) return ok([]);
    return ok(await describeActivity(deps, { userId, spaces, places, transactions }));
  };
