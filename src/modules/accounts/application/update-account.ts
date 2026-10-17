import { ok, type Money, type Result } from "@/shared/kernel";
import { reviseAccount, type AccountType, type AttributeChanges } from "../domain/account";
import { accountForChange } from "./account-for-change";
import { withBalances, type AccountView } from "./account-view";
import { minorIn } from "./currency";
import type { AccountsDeps } from "./deps";

export interface AccountChanges {
  readonly name?: string;
  readonly type?: AccountType;
  readonly openingBalance?: Money;
  readonly attributes?: AttributeChanges;
}

export type UpdateAccount = (input: {
  spaceId: string;
  userId: string;
  accountId: string;
  changes: AccountChanges;
}) => Promise<Result<AccountView>>;

export const createUpdateAccount =
  (deps: AccountsDeps): UpdateAccount =>
  (input) =>
    deps.tm.run(async () => {
      const target = await accountForChange(deps, input);
      if (!target.ok) return target;
      const { space, account, siblings } = target.value;
      const { changes } = input;
      const openingBalance =
        changes.openingBalance === undefined
          ? ok(undefined)
          : minorIn(space.currency, changes.openingBalance);
      if (!openingBalance.ok) return openingBalance;
      const revised = reviseAccount(
        account,
        {
          name: changes.name,
          type: changes.type,
          openingBalance: openingBalance.value,
          attributes: changes.attributes,
        },
        siblings,
      );
      if (!revised.ok) return revised;
      await deps.accounts.save(revised.value);
      const [view] = await withBalances(deps.movements, [revised.value], space.currency, null);
      return ok(view!);
    });
