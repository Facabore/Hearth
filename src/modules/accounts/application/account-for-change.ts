import { requirePermission, requireRole, WRITERS, type SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { Account } from "../domain/account";
import type { AccountsDeps } from "./deps";

/** The account to change, authorized: its owner for personal accounts, OWNER or ADMIN for shared funds. */
export const accountForChange = async (
  deps: Pick<AccountsDeps, "access" | "accounts">,
  input: { readonly spaceId: string; readonly userId: string; readonly accountId: string },
): Promise<Result<{ space: SpaceMembership; account: Account; siblings: Account[] }>> => {
  const membership = await deps.access(input.spaceId, input.userId);
  if (!membership.ok) return membership;
  const writer = requireRole(membership.value, WRITERS);
  if (!writer.ok) return writer;
  const siblings = await deps.accounts.listBySpace(writer.value.spaceId);
  const account = siblings.find((a) => a.id === input.accountId);
  if (!account) return err(domainError("AccountNotFound"));
  if (account.ownerUserId === null) {
    // HU-E2-02: shared fund accounts are managed by OWNER and ADMIN only.
    const manager = requirePermission(writer.value, "fund.manage");
    if (!manager.ok) return manager;
  } else if (account.ownerUserId !== input.userId) {
    return err(domainError("InsufficientRole"));
  }
  return ok({ space: writer.value, account, siblings });
};
