import type { SpaceRepository } from "@/modules/spaces/application";
import { ok, type Result } from "@/shared/kernel";
import type { AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";
import { createListAccounts } from "./list-accounts";

/** #338: one of the viewer's spaces with its accounts, as that space's own list answers them. */
export interface MyAccounts {
  readonly spaceId: string;
  readonly accounts: readonly AccountView[];
}

export type ListMyAccounts = (input: {
  userId: string;
  includeArchived: boolean;
}) => Promise<Result<MyAccounts[]>>;

export interface ListMyAccountsDeps extends AccountsDeps {
  readonly spaces: Pick<SpaceRepository, "listForUser">;
}

/**
 * #338: the accounts of each of the viewer's active spaces, personal included, in one read, for the filters of the
 * personal Movimientos across every space (ruling P319). Each space goes through ListAccounts, so it authorizes as that
 * list does and its balances are computed on read (D7); a space it refuses is left out. The spaces' totals are not
 * part of it: no filter shows them.
 */
export const createListMyAccounts = (deps: ListMyAccountsDeps): ListMyAccounts => {
  const listAccounts = createListAccounts(deps);
  return async ({ userId, includeArchived }) => {
    const spaces = await deps.spaces.listForUser(userId);
    const lists = await Promise.all(
      spaces.map(async (space): Promise<MyAccounts | null> => {
        const list = await listAccounts({ spaceId: space.id, userId, includeArchived });
        return list.ok ? { spaceId: space.id, accounts: list.value.items } : null;
      }),
    );
    return ok(lists.filter((list) => list !== null));
  };
};
