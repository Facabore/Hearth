import { requirePermission, requireRole, WRITERS } from "@/modules/spaces/application";
import { domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import { openAccount, type AccountType, type AttributeChanges } from "../domain/account";
import { todayFor, toView, type AccountView } from "./account-view";
import { minorIn, termsIn, type TermsInput } from "./currency";
import type { AccountsDeps } from "./deps";

export interface CreateAccountInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly openingBalance: Money;
  readonly attributes?: AttributeChanges;
  readonly terms?: TermsInput;
}

export type CreateAccount = (input: CreateAccountInput) => Promise<Result<AccountView>>;

export const createCreateAccount =
  (deps: AccountsDeps): CreateAccount =>
  (input) =>
    deps.tm.run(async () => {
      // Issue #245: before the membership, so a currency change in progress is waited for and its currency is read.
      await deps.spaceLocks.lockForMoneyWrite(input.spaceId);
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
      const terms = termsIn(space.currency, input.terms);
      if (!terms.ok) return terms;
      const account = openAccount({
        id: deps.ids.next<"Account">(),
        spaceId: space.spaceId,
        spaceKind: space.spaceKind,
        ownerUserId: input.userId,
        name: input.name,
        type: input.type,
        openingBalance: openingBalance.value,
        attributes: input.attributes,
        terms: terms.value,
        now: deps.clock.now(),
        siblings: await deps.accounts.listBySpace(space.spaceId),
      });
      if (!account.ok) return account;
      // Issue #245: a concurrent writer may take the name after the siblings were read; the store decides then.
      if (!(await deps.accounts.addUnlessNameTaken(account.value)))
        return err(domainError("AccountNameTaken"));
      // A new account has no movements yet.
      return ok(toView(account.value, space.currency, await todayFor(deps, input.userId)));
    });
