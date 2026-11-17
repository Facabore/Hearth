import {
  addDays,
  ok,
  todayIn,
  type Clock,
  type LocalDate,
  type Result,
  type UserTimeZones,
} from "@/shared/kernel";

/** Ruling P337: the days "Desde" looks back over, today included. */
export const USAGE_WINDOW_DAYS = 90;

/** How often one of the caller's accounts moved money in the window, and the last day it did. */
export interface AccountUse {
  readonly accountId: string;
  readonly uses: number;
  readonly lastUsedOn: LocalDate;
}

/** The account the caller last paid an expense of a category from, in the window. */
export interface CategoryAccount {
  readonly categoryId: string;
  readonly accountId: string;
}

/**
 * Ruling P337: over the live movements dated `from` or later, each active account the user owns with the movements that
 * took money out of it or into it (adjustments left out: nobody picks an account for them), and, per expense category,
 * the account of the latest payment from one of those accounts. Unordered.
 */
export interface AccountUsageQuery {
  accountUsage(
    userId: string,
    from: LocalDate,
  ): Promise<{ readonly accounts: readonly AccountUse[]; readonly categories: readonly CategoryAccount[] }>;
}

export interface AccountUsage {
  /** The first day counted, in the caller's time zone. */
  readonly since: LocalDate;
  /** The caller's accounts that moved money in the window, the most used first; a tie goes to the latest used. */
  readonly accounts: readonly AccountUse[];
  readonly categories: readonly CategoryAccount[];
}

export interface AccountUsageDeps {
  readonly usage: AccountUsageQuery;
  readonly clock: Clock;
  readonly userTimeZones: UserTimeZones;
}

export type GetAccountUsage = (input: { readonly userId: string }) => Promise<Result<AccountUsage>>;

/**
 * Ruling P337 (#334): what "Desde" orders the caller's accounts by and what it preselects for a category. The figures
 * are computed on read (D7) over the last 90 days of the caller's own zone.
 */
export const createGetAccountUsage =
  (deps: AccountUsageDeps): GetAccountUsage =>
  async ({ userId }) => {
    const today = todayIn(deps.clock, await deps.userTimeZones.timeZoneOf(userId));
    const since = addDays(today, 1 - USAGE_WINDOW_DAYS);
    const { accounts, categories } = await deps.usage.accountUsage(userId, since);
    return ok({
      since,
      accounts: [...accounts].sort(
        (a, b) =>
          b.uses - a.uses ||
          b.lastUsedOn.localeCompare(a.lastUsedOn) ||
          a.accountId.localeCompare(b.accountId),
      ),
      categories,
    });
  };
