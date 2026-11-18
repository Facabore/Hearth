import type { SpaceId, SpaceRepository } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import { pairwiseDebtsByCurrency } from "../domain/balances";
import {
  createGetSpaceBalances,
  type BalanceSource,
  type BalancesDeps,
  type CurrencyNet,
  type DebtSource,
  netsOf,
} from "./get-space-balances";

/** One space with balances, as its viewer stands in it (#240, ruling P278). */
export interface MyBalance {
  readonly spaceId: string;
  readonly currency: string;
  /** The viewer's member id in the space (Saldos' `?settle=` opens the settle sheet with it). */
  readonly memberId: string;
  /** The viewer's net in the space currency: negative when it is her turn to put money in, positive when she is owed. */
  readonly net: bigint;
  /** Ruling P342 (S4): the viewer's non-zero nets in every currency, never converted, the space's first. */
  readonly nets: readonly CurrencyNet[];
  /** The current members in join order, guests included, by the name the space knows them by. */
  readonly members: readonly { readonly memberId: string; readonly name: string }[];
  /**
   * The settle-up suggestions (HU-E5-03, pairwise since ruling P323) in which the viewer pays, each in its debt's
   * currency (P342): the space's first, then by ISO code, and the largest first inside a currency.
   */
  readonly payments: readonly {
    readonly receivingMemberId: string;
    readonly amount: bigint;
    readonly currency: string;
  }[];
}

export type GetMyBalances = (userId: string) => Promise<Result<MyBalance[]>>;

export interface MyBalancesDeps extends BalancesDeps {
  readonly source: BalanceSource & DebtSource;
  readonly spaces: Pick<SpaceRepository, "listForUser">;
}

/**
 * #240 (ruling P278): the viewer's standing in each of her active shared and direct spaces, for the space switcher
 * and Inicio. Computed on read (D7) through GetSpaceBalances, so it authorizes as Saldos does; the personal space has
 * no balances and is left out.
 */
export const createGetMyBalances = (deps: MyBalancesDeps): GetMyBalances => {
  const getBalances = createGetSpaceBalances(deps);
  return async (userId) => {
    const spaces = (await deps.spaces.listForUser(userId)).filter((space) => space.kind !== "PERSONAL");
    const standings = await Promise.all(
      spaces.map(async (space): Promise<MyBalance | null> => {
        const balances = await getBalances({ spaceId: space.id, userId });
        if (!balances.ok) return null;
        const members = await deps.members.listCurrent(space.id as SpaceId);
        const me = members.find((member) => member.userId === userId);
        if (!me) return null;
        const { currency } = balances.value;
        // Ruling P323: current members only, in join order; a debt to someone who left goes through them.
        const current = members.map((member) => member.id);
        const debts = pairwiseDebtsByCurrency(currency, current, await deps.source.debtMovements(space.id));
        if (!debts.ok) return null;
        return {
          spaceId: space.id,
          currency,
          memberId: me.id,
          net: balances.value.members.find((standing) => standing.memberId === me.id)?.net ?? 0n,
          nets: netsOf(balances.value.byCurrency, me.id),
          members: members.map((member) => ({ memberId: member.id, name: member.displayName })),
          payments: debts.value
            .filter((suggestion) => suggestion.payerMemberId === me.id)
            .map((suggestion) => ({
              receivingMemberId: suggestion.receivingMemberId,
              amount: suggestion.amount,
              currency: suggestion.currency,
            })),
        };
      }),
    );
    return ok(standings.filter((standing) => standing !== null));
  };
};
