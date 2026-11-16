import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES } from "@/modules/accounts/application";
import { accountTypeForGroup } from "../domain/account-type-map";

/**
 * Guards the copy in `SourceAccountType` against the accounts module's real list: every type the group map can produce
 * must still be a Hearth account type. The map never produces SHARED_FUND, which a personal import never creates.
 */
describe("account-type map stays within the accounts module's types", () => {
  it("maps every group (both balance signs) to a real, non-shared account type", () => {
    for (let group = 1; group <= 11; group += 1) {
      for (const balanceNegative of [true, false]) {
        const type = accountTypeForGroup(group, balanceNegative);
        expect(ACCOUNT_TYPES).toContain(type);
        expect(type).not.toBe("SHARED_FUND");
      }
    }
  });
});
