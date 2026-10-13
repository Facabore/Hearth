import { authorizeSpaceAction, type SpaceMember, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import type { LedgerDeps } from "./deps";
import type { LedgerAccount } from "./ports";

/** HU-E1-05: recording money movements is the matrix action money.record (MEMBER or above). */
export const authorizeWriter = (
  deps: Pick<LedgerDeps, "access">,
  spaceId: string,
  userId: string,
): Promise<Result<SpaceMembership>> => authorizeSpaceAction(deps.access, spaceId, userId, "money.record");

/** D6: amounts are in the space currency. */
export const inSpaceCurrency = (space: SpaceMembership, money: Money): Result<Money> =>
  money.currency.code === space.currency
    ? ok(money)
    : err(domainError("CurrencyMismatch", { expected: space.currency, actual: money.currency.code }));

/** HU-E4-01 / HU-E3-03: a category of the space that is not archived. */
export const usableCategory = async (
  deps: Pick<LedgerDeps, "categories">,
  spaceId: string,
  categoryId: string | null | undefined,
): Promise<Result<string>> => {
  if (categoryId === undefined || categoryId === null) return err(domainError("CategoryRequired"));
  const category = await deps.categories.find(spaceId, categoryId);
  if (category === null) return err(domainError("CategoryNotFound"));
  return category.archived ? err(domainError("CategoryArchived")) : ok(category.id);
};

/** D9: registered members move money only through accounts they own; archived accounts take no new movements. */
export const ownAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  accountId: string,
  userId: string,
): Promise<Result<LedgerAccount>> => {
  const account = await deps.accounts.find(accountId);
  if (account === null) return err(domainError("AccountNotFound"));
  if (account.ownerUserId !== userId) return err(domainError("AccountNotOwned"));
  return account.archived ? err(domainError("AccountArchived")) : ok(account);
};

/** HU-E4-02/03: income and own transfers stay inside the transaction's space. */
export const accountInSpace = (account: LedgerAccount, spaceId: string): Result<LedgerAccount> =>
  account.spaceId === spaceId ? ok(account) : err(domainError("AccountNotInSpace"));

export const openPeriod = async (
  deps: Pick<LedgerDeps, "closedPeriods">,
  spaceId: string,
  date: LocalDate,
): Promise<Result<void>> =>
  (await deps.closedPeriods.isClosed(spaceId, date)) ? err(domainError("PeriodClosed")) : ok(undefined);

/**
 * Spec 5.2, D9, D15: the account a current member moves money through. A guest has none
 * (GuestHasNoAccounts); a registered member uses an account their own user owns, which may live in
 * their personal space. `required` is false only where accounts are optional (settlements).
 * `debitedBy` is the requester on debits: nobody spends from another member's account (D9).
 */
export const partyAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  members: readonly SpaceMember[],
  memberId: string,
  accountId: string | null,
  options: { readonly required: boolean; readonly debitedBy?: string },
): Promise<Result<string | null>> => {
  const member = members.find((m) => m.id === memberId);
  if (member === undefined) return err(domainError("NotASpaceMember"));
  // D15: a member without a user is a guest.
  if (member.userId === null) return accountId === null ? ok(null) : err(domainError("GuestHasNoAccounts"));
  if (accountId === null) return options.required ? err(domainError("AccountRequired")) : ok(null);
  // D9: only the account's owner records a debit from it; crediting another member's account is allowed.
  if (options.debitedBy !== undefined && options.debitedBy !== member.userId) {
    return err(domainError("AccountNotOwned"));
  }
  return map(await ownAccount(deps, accountId, member.userId), (account) => account.id);
};

/**
 * HU-E4-09/10: the shared fund of the transaction's space, recognised by its type (never by a missing
 * owner). A fund of another space is AccountNotFound, so other spaces' accounts never leak.
 */
export const fundAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  accountId: string,
  spaceId: string,
): Promise<Result<LedgerAccount>> => {
  const account = await deps.accounts.find(accountId);
  if (account === null || account.spaceId !== spaceId) return err(domainError("AccountNotFound"));
  if (!account.isSharedFund) return err(domainError("InvalidFundAccount"));
  return account.archived ? err(domainError("AccountArchived")) : ok(account);
};
