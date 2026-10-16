import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import type { BudgetLine, LineContext } from "../domain/budget-line";
import { totalCapacity } from "../domain/capacity";
import type { BudgetAccount, PlanContents, SavingsAccountReader } from "./ports";

/** D6: amounts are in the space currency. */
export const inSpaceCurrency = (space: SpaceMembership, money: Money): Result<bigint> =>
  money.currency.code === space.currency
    ? ok(money.minor)
    : err(domainError("CurrencyMismatch", { expected: space.currency, actual: money.currency.code }));

/** A current line of the plan; a removed line, another plan's line or a malformed id is BudgetLineNotFound. */
export const lineOf = (parts: PlanContents, lineId: string): Result<BudgetLine> => {
  const line = parts.lines.find((l) => l.id === lineId);
  return line === undefined ? err(domainError("BudgetLineNotFound")) : ok(line);
};

/** What a line written into the plan sees: the other current lines, the current members' capacity, its categories. */
export const lineContext = (
  parts: PlanContents,
  members: readonly SpaceMember[],
  lineId: string | null,
): LineContext => ({
  siblings: parts.lines.filter((l) => l.id !== lineId),
  totalCapacity: totalCapacity(
    parts.capacities,
    members.map((m) => m.id),
  ),
  mappedCategories: parts.mappings.filter((m) => m.lineId === lineId).length,
});

/**
 * HU-E6-03, P8 (amended after the final review): the accounts a SAVINGS line newly names are SAVINGS accounts the
 * caller owns, like the ledger's `ownAccount` (D9): a member's savings reach the group only by their own act. Every
 * account the caller cannot attach (unknown, malformed, ownerless, another user's, whatever its type or state)
 * answers the same AccountNotFound, so none is revealed. Of the caller's own, a non-SAVINGS account answers
 * InvalidSavingsAccount, an archived one AccountArchived and one in another currency than the space's
 * CurrencyMismatch (D6). Accounts the line already named are not checked again.
 */
export const usableSavingsAccounts = async (
  accounts: SavingsAccountReader,
  attach: { readonly callerUserId: string; readonly spaceCurrency: string },
  accountIds: readonly string[],
  already: readonly string[] = [],
): Promise<Result<void>> => {
  for (const accountId of accountIds.filter((id) => !already.includes(id))) {
    const account = await accounts.find(accountId);
    if (account === null || account.ownerUserId !== attach.callerUserId) {
      return err(domainError("AccountNotFound"));
    }
    if (!account.isSavings) return err(domainError("InvalidSavingsAccount", { reason: "notSavingsAccount" }));
    if (account.archived) return err(domainError("AccountArchived"));
    if (account.currency !== attach.spaceCurrency) {
      return err(
        domainError("CurrencyMismatch", { expected: attach.spaceCurrency, actual: account.currency }),
      );
    }
  }
  return ok(undefined);
};

/**
 * P8 (amended): whether an account of a SAVINGS line counts for a space, that is, whether its owner is a current
 * registered member of it (a guest owns no account, and the account of a member who left stops counting). The one
 * rule behind the figures read at any time and the accounts a copy keeps, so the two cannot drift.
 */
export const ownedByRegisteredMember = (members: readonly SpaceMember[]) => {
  const owners = new Set(members.flatMap((m) => (m.userId === null ? [] : [m.userId])));
  return (account: Pick<BudgetAccount, "ownerUserId">): boolean => owners.has(account.ownerUserId);
};

/**
 * HU-E6-06, ruling P10: of the accounts a source plan's SAVINGS lines name, the ones its copy keeps: still a SAVINGS
 * account, not archived, in the plan space's currency (D6), and owned by a current registered member of the space
 * (P8 amended). Their owners attached them (P8), so a copy names no account anew and asks nothing of its caller.
 */
export const copyableSavingsAccounts = async (
  accounts: SavingsAccountReader,
  space: { readonly members: readonly SpaceMember[]; readonly spaceCurrency: string },
  accountIds: readonly string[],
): Promise<string[]> => {
  const counts = ownedByRegisteredMember(space.members);
  const kept: string[] = [];
  for (const accountId of new Set(accountIds)) {
    const account = await accounts.find(accountId);
    if (account === null || !counts(account)) continue;
    if (account.isSavings && !account.archived && account.currency === space.spaceCurrency) {
      kept.push(accountId);
    }
  }
  return kept;
};
