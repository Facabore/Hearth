import { ok, type Result } from "@/shared/kernel";
import { archiveAccount } from "../domain/account";
import { accountForChange } from "./account-for-change";
import { todayFor, withBalances, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";

export type ArchiveAccount = (input: {
  spaceId: string;
  userId: string;
  accountId: string;
}) => Promise<Result<AccountView>>;

export const createArchiveAccount =
  (deps: AccountsDeps): ArchiveAccount =>
  (input) =>
    deps.tm.run(async () => {
      const target = await accountForChange(deps, input);
      if (!target.ok) return target;
      const archived = archiveAccount(target.value.account, deps.clock.now());
      await deps.accounts.save(archived);
      const [view] = await withBalances(
        deps.movements,
        [archived],
        target.value.space.currency,
        null,
        await todayFor(deps, input.userId),
      );
      return ok(view!);
    });
