import { ok, type Result } from "@/shared/kernel";
import { restoreAccount } from "../domain/account";
import { accountForChange } from "./account-for-change";
import { todayFor, withBalances, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";

export type RestoreAccount = (input: {
  spaceId: string;
  userId: string;
  accountId: string;
}) => Promise<Result<AccountView>>;

export const createRestoreAccount =
  (deps: AccountsDeps): RestoreAccount =>
  (input) =>
    deps.tm.run(async () => {
      const target = await accountForChange(deps, input);
      if (!target.ok) return target;
      const restored = restoreAccount(target.value.account);
      await deps.accounts.save(restored);
      const [view] = await withBalances(
        deps.movements,
        [restored],
        target.value.space.currency,
        null,
        await todayFor(deps, input.userId),
      );
      return ok(view!);
    });
