import {
  authorizeSpaceAction,
  type SpaceAccess,
  type SpaceMemberRepository,
} from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import {
  memberStandingsByCurrency,
  type CurrencyStandings,
  type DebtMovements,
  type MemberStanding,
  type MemberTotals,
} from "../domain/balances";

/**
 * Per-member totals of one space's live ledger (E5 balance rule), one row per member and currency (ruling P342); bound
 * to the ledger by the composition root.
 */
export interface BalanceSource {
  memberTotals(spaceId: string): Promise<readonly MemberTotals[]>;
}

/**
 * Ruling P323: the live member-paid expenses (payments and shares in position order) and live settlements of one space,
 * read in one snapshot; bound to the ledger by the composition root.
 */
export interface DebtSource {
  debtMovements(spaceId: string): Promise<DebtMovements>;
}

export interface BalancesDeps {
  readonly access: SpaceAccess;
  readonly members: Pick<SpaceMemberRepository, "listCurrent">;
  readonly source: BalanceSource;
}

export interface SpaceBalances {
  readonly spaceId: string;
  /** The space's currency, the one `members` is in. */
  readonly currency: string;
  /**
   * The standings in the space's currency (`byCurrency[0]`): current members in join order, guests included, then
   * former members with a non-zero history; nets sum to zero.
   */
  readonly members: readonly MemberStanding[];
  /**
   * Ruling P342 (S4): the standings of every currency, never converted: the space's first (always there), then every
   * other currency a live movement was made in, by ISO code. Each group follows the rules of `members`.
   */
  readonly byCurrency: readonly CurrencyStandings[];
}

/** Ruling P342: one member's net in one currency. */
export interface CurrencyNet {
  readonly currency: string;
  readonly net: bigint;
}

/** Ruling P342: `memberId`'s non-zero nets, in the order of `byCurrency` (the space currency first). */
export const netsOf = (byCurrency: readonly CurrencyStandings[], memberId: string): CurrencyNet[] =>
  byCurrency.flatMap(({ currency, members }) => {
    const net = members.find((standing) => standing.memberId === memberId)?.net ?? 0n;
    return net === 0n ? [] : [{ currency, net }];
  });

export type GetSpaceBalances = (input: { spaceId: string; userId: string }) => Promise<Result<SpaceBalances>>;

/**
 * HU-E5-01: who owes whom, computed on read (D7) in every currency apart (ruling P342); any member may read,
 * non-members get SpaceNotFound.
 */
export const createGetSpaceBalances =
  (deps: BalancesDeps): GetSpaceBalances =>
  async ({ spaceId, userId }) => {
    const reader = await authorizeSpaceAction(deps.access, spaceId, userId, "space.read");
    if (!reader.ok) return reader;
    const space = reader.value;
    const members = await deps.members.listCurrent(space.spaceId);
    const totals = await deps.source.memberTotals(space.spaceId);
    const byCurrency = memberStandingsByCurrency(
      space.currency,
      members.map((m) => m.id),
      totals,
    );
    // memberStandingsByCurrency always answers the space currency's group first.
    return ok({
      spaceId: space.spaceId,
      currency: space.currency,
      members: byCurrency[0]!.members,
      byCurrency,
    });
  };
