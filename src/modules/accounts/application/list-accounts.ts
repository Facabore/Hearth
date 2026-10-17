import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
import { todayFor, withBalances, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";

export type ListAccounts = (input: {
  spaceId: string;
  userId: string;
  includeArchived: boolean;
  asOf?: LocalDate;
}) => Promise<Result<AccountView[]>>;

export type GetAccount = (input: {
  spaceId: string;
  userId: string;
  accountId: string;
  asOf?: LocalDate;
}) => Promise<Result<AccountView>>;

/** HU-E2-03/04: archived accounts only on request; balances computed on read (D7). */
export const createListAccounts =
  (deps: AccountsDeps): ListAccounts =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const accounts = (await deps.accounts.listBySpace(membership.value.spaceId))
      .filter((a) => input.includeArchived || a.archivedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const today = await todayFor(deps, input.userId);
    return ok(
      await withBalances(deps.movements, accounts, membership.value.currency, input.asOf ?? null, today),
    );
  };

export const createGetAccount =
  (deps: AccountsDeps): GetAccount =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const account = (await deps.accounts.listBySpace(membership.value.spaceId)).find(
      (a) => a.id === input.accountId,
    );
    if (!account) return err(domainError("AccountNotFound"));
    const [view] = await withBalances(
      deps.movements,
      [account],
      membership.value.currency,
      input.asOf ?? null,
      await todayFor(deps, input.userId),
    );
    return ok(view!);
  };
