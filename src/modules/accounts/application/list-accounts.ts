import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
import { withBalances, type AccountView } from "./account-view";
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
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const accounts = (await deps.accounts.listBySpace(membership.value.spaceId))
      .filter((a) => input.includeArchived || a.archivedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    return ok(await withBalances(deps.movements, accounts, membership.value.currency, input.asOf ?? null));
  };

export const createGetAccount =
  (deps: AccountsDeps): GetAccount =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
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
    );
    return ok(view!);
  };
