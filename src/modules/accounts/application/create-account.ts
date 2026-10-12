import { requireRole, WRITERS } from "@/modules/spaces/application";
import { ok, type Money, type Result } from "@/shared/kernel";
import { openAccount, type AccountType } from "../domain/account";
import { toView, type AccountView } from "./account-view";
import { minorIn } from "./currency";
import type { AccountsDeps } from "./deps";

export interface CreateAccountInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly openingBalance: Money;
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
      const space = writer.value;
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
        now: deps.clock.now(),
        siblings: await deps.accounts.listBySpace(space.spaceId),
      });
      if (!account.ok) return account;
      await deps.accounts.add(account.value);
      // A new account has no movements yet.
      return ok(toView(account.value, space.currency));
    });
