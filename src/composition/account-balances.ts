import type { GetAccount } from "@/modules/accounts/application";
import type { AccountBalances } from "@/modules/ledger/application";

/** HU-E4-10: the accounts module owns the balance formula (opening balance + movements, HU-E2-04). */
export const accountBalancesFrom = (getAccount: GetAccount): AccountBalances => ({
  balanceOf: async (spaceId, userId, accountId) => {
    const account = await getAccount({ spaceId, userId, accountId });
    // The fund was found in this space within the same transaction, so this read succeeds; if it ever
    // did not, a silent 0 would hide a FundBalanceNegative warning.
    if (!account.ok) {
      throw new Error(`cannot read the balance of account ${accountId}: ${account.error.code}`);
    }
    return account.value.balance;
  },
});
