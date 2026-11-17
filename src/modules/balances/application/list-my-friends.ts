import {
  directPeer,
  friendName,
  type FriendName,
  type FriendNameRepository,
  type SpaceId,
  type SpaceRepository,
} from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import { createGetSpaceBalances, type BalancesDeps } from "./get-space-balances";

/** Ruling P338: the newest live movement of a direct space; bound to the ledger by the composition root. */
export interface LastMovement {
  readonly spaceId: string;
  readonly transactionId: string;
  readonly date: string;
  readonly description: string;
  readonly type: "EXPENSE" | "INCOME" | "TRANSFER" | "SETTLEMENT" | "ADJUSTMENT";
}

export interface LastMovementSource {
  /** The newest live movement of each of `spaceIds` that has one. */
  lastMovementsIn(spaceIds: readonly string[]): Promise<readonly LastMovement[]>;
}

/** Ruling P338: one person in Amigos, the other member of one of the viewer's direct spaces. */
export interface Friend extends FriendName {
  readonly spaceId: string;
  readonly currency: string;
  readonly me: { readonly memberId: string };
  /** The viewer's net in the space: positive when the other one owes her, negative when she owes them. */
  readonly net: bigint;
  readonly lastMovement: Omit<LastMovement, "spaceId"> | null;
}

export type ListMyFriends = (userId: string) => Promise<Result<Friend[]>>;

export interface ListMyFriendsDeps extends BalancesDeps {
  readonly spaces: Pick<SpaceRepository, "listForUser">;
  readonly aliases: Pick<FriendNameRepository, "peerAliasesOf">;
  readonly movements: LastMovementSource;
}

/** Newest last movement first, people without one last; then by name, then by space so the order is total. */
export const friendOrder = (a: Friend, b: Friend): number => {
  const dateA = a.lastMovement?.date ?? "";
  const dateB = b.lastMovement?.date ?? "";
  if (dateA !== dateB) return dateA < dateB ? 1 : -1;
  const nameA = a.name.toLowerCase();
  const nameB = b.name.toLowerCase();
  if (nameA !== nameB) return nameA < nameB ? -1 : 1;
  return a.spaceId < b.spaceId ? -1 : a.spaceId > b.spaceId ? 1 : 0;
};

/**
 * Ruling P338: Amigos, one row per active direct space of the viewer, with the other member by the name she gives
 * them, her net there (computed on read, D7, through GetSpaceBalances, so it authorizes as Saldos does) and the last
 * movement. In a direct space every movement names both members, so the newest live one involves the viewer (P329).
 */
export const createListMyFriends = (deps: ListMyFriendsDeps): ListMyFriends => {
  const getBalances = createGetSpaceBalances(deps);
  return async (userId) => {
    const direct = (await deps.spaces.listForUser(userId)).filter((space) => space.kind === "DIRECT");
    if (direct.length === 0) return ok([]);
    const ids = direct.map((space) => space.id);
    const [aliases, movements] = await Promise.all([
      deps.aliases.peerAliasesOf(userId),
      deps.movements.lastMovementsIn(ids),
    ]);
    const aliasOf = new Map(aliases.map((row) => [row.spaceId, row.alias]));
    const lastOf = new Map(movements.map(({ spaceId, ...movement }) => [spaceId, movement]));
    const friends = await Promise.all(
      direct.map(async (space): Promise<Friend | null> => {
        const balances = await getBalances({ spaceId: space.id, userId });
        if (!balances.ok) return null;
        const members = await deps.members.listCurrent(space.id as SpaceId);
        const me = members.find((member) => member.userId === userId);
        const other = me && directPeer(members, me.id);
        if (!me || !other) return null;
        return {
          spaceId: space.id,
          currency: balances.value.currency,
          me: { memberId: me.id },
          ...friendName(other, aliasOf.get(space.id) ?? null),
          net: balances.value.members.find((standing) => standing.memberId === me.id)?.net ?? 0n,
          lastMovement: lastOf.get(space.id) ?? null,
        };
      }),
    );
    return ok(friends.filter((friend) => friend !== null).sort(friendOrder));
  };
};
