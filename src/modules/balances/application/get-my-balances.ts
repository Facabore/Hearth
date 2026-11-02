import type { SpaceId, SpaceRepository } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import { simplifyDebts } from "../domain/balances";
import { createGetSpaceBalances, type BalancesDeps } from "./get-space-balances";

/** One space with balances, as its viewer stands in it (#240, ruling P278). */
export interface MyBalance {
  readonly spaceId: string;
  readonly currency: string;
  /** The viewer's member id in the space (Saldos' `?settle=` opens the settle sheet with it). */
  readonly memberId: string;
  /** The viewer's net: negative when it is her turn to put money in, positive when she is owed. */
  readonly net: bigint;
  /** The current members in join order, guests included, by the name the space knows them by. */
  readonly members: readonly { readonly memberId: string; readonly name: string }[];
  /** The settle-up suggestions (HU-E5-03) in which the viewer pays, the largest first. */
  readonly payments: readonly { readonly receivingMemberId: string; readonly amount: bigint }[];
}

export type GetMyBalances = (userId: string) => Promise<Result<MyBalance[]>>;

export interface MyBalancesDeps extends BalancesDeps {
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
        return {
          spaceId: space.id,
          currency: balances.value.currency,
          memberId: me.id,
          net: balances.value.members.find((standing) => standing.memberId === me.id)?.net ?? 0n,
          members: members.map((member) => ({ memberId: member.id, name: member.displayName })),
          payments: simplifyDebts(balances.value.members)
            .filter((suggestion) => suggestion.payerMemberId === me.id)
            .map((suggestion) => ({
              receivingMemberId: suggestion.receivingMemberId,
              amount: suggestion.amount,
            })),
        };
      }),
    );
    return ok(standings.filter((standing) => standing !== null));
  };
};
