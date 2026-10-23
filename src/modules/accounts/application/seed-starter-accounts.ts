import { MANAGERS, requireRole } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { openAccount, type Account } from "../domain/account";
import { starterAccountsIn } from "../domain/starter-accounts";
import { todayFor, toView, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";

export type SeedStarterAccounts = (input: {
  readonly spaceId: string;
  readonly userId: string;
  readonly locale: string;
}) => Promise<Result<AccountView[]>>;

/**
 * Issue 169: opens the starter accounts in `locale` in a personal space its manager holds, at zero; a name the space
 * already holds (ignoring case, archived ones included) is skipped, so a second call creates nothing, even one running
 * at the same time (`addUnlessNameTaken`). Sign-up calls
 * it in the personal space's own transaction; the Accounts screen's empty state calls it over HTTP.
 */
export const createSeedStarterAccounts =
  (deps: AccountsDeps): SeedStarterAccounts =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const manager = requireRole(membership.value, MANAGERS);
      if (!manager.ok) return manager;
      const space = manager.value;
      if (space.spaceKind !== "PERSONAL") return err(domainError("PersonalAccountRequiresPersonalSpace"));
      const siblings = await deps.accounts.listBySpace(space.spaceId);
      const opened: Account[] = [];
      for (const starter of starterAccountsIn(input.locale)) {
        const account = openAccount({
          id: deps.ids.next<"Account">(),
          spaceId: space.spaceId,
          spaceKind: space.spaceKind,
          ownerUserId: input.userId,
          name: starter.name,
          type: starter.type,
          openingBalance: 0n,
          now: deps.clock.now(),
          siblings: [...siblings, ...opened],
        });
        // The domain's own uniqueness rule decides what already exists.
        if (!account.ok && account.error.code === "AccountNameTaken") continue;
        if (!account.ok) return account;
        // A parallel call may be inserting the same name: the store skips it then, so each starter exists once.
        if (await deps.accounts.addUnlessNameTaken(account.value)) opened.push(account.value);
      }
      const today = await todayFor(deps, input.userId);
      // New accounts have no movements yet.
      return ok(opened.map((account) => toView(account, space.currency, today)));
    });
