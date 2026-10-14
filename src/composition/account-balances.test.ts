import { describe, expect, it } from "vitest";
import type { AccountView, GetAccount } from "@/modules/accounts/application";
import { domainError, err, ok } from "@/shared/kernel";
import { accountBalancesFrom } from "./account-balances";

describe("accountBalancesFrom (HU-E4-10)", () => {
  it("reads the balance the accounts module computes", async () => {
    const getAccount: GetAccount = async () => ok({ balance: -50_000_000n } as AccountView);
    const balances = accountBalancesFrom(getAccount);
    expect(await balances.balanceOf("space-household", "u-ana", "acc-household-fund")).toBe(-50_000_000n);
  });

  // A silent 0 would hide a FundBalanceNegative warning, so an unreadable fund is an error, not a balance.
  it("throws when it cannot read the account instead of answering 0", async () => {
    const getAccount: GetAccount = async () => err(domainError("AccountNotFound"));
    const balances = accountBalancesFrom(getAccount);
    await expect(balances.balanceOf("space-household", "u-ana", "acc-household-fund")).rejects.toThrow(
      "AccountNotFound",
    );
  });
});
