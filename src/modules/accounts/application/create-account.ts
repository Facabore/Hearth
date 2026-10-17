import { requirePermission, requireRole, WRITERS } from "@/modules/spaces/application";
import { ok, type Money, type Result } from "@/shared/kernel";
import { openAccount, type AccountType, type AttributeChanges } from "../domain/account";
import { toView, type AccountView } from "./account-view";
import { minorIn } from "./currency";
import type { AccountsDeps } from "./deps";

export interface CreateAccountInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly openingBalance: Money;
  readonly attributes?: AttributeChanges;
}

export type CreateAccount = (input: CreateAccountInput) => Promise<Result<AccountView>>;

export const createCreateAccount =
  (deps: AccountsDeps): CreateAccount =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const writer = requireRole(membership.value, WRITERS);
      if (!writer.ok) return writer;
      // HU-E2-02: only OWNER and ADMIN manage shared funds.
      const allowed = input.type === "SHARED_FUND" ? requirePermission(writer.value, "fund.manage") : writer;
      if (!allowed.ok) return allowed;
      const space = allowed.value;
      const openingBalance = minorIn(space.currency, input.openingBalance);
      if (!openingBalance.ok) return openingBalance;
      const account = openAccount({
        id: deps.ids.next<"Account">(),
        spaceId: space.spaceId,
        spaceKind: space.spaceKind,
        ownerUserId: input.userId,
        name: input.name,
        type: input.type,
        openingBalance: openingBalance.value,
        attributes: input.attributes,
        now: deps.clock.now(),
        siblings: await deps.accounts.listBySpace(space.spaceId),
      });
      if (!account.ok) return account;
      await deps.accounts.add(account.value);
      // A new account has no movements yet.
      return ok(toView(account.value, space.currency));
    });
