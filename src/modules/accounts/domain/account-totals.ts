import { switchesOf, type Account } from "./account";

/** HU-E2-07, D21: a space's "Disponible" and "Patrimonio neto", in minor units of its currency. */
export interface AccountTotals {
  readonly available: bigint;
  readonly netWorth: bigint;
}

/**
 * HU-E2-07, rulings P51 and P53: Σ signed balances of the active accounts with each switch (liabilities are negative,
 * so net worth is assets minus debts); archived accounts never count. Computed on read (D7).
 */
export const totalsOf = (accounts: readonly (Account & { readonly balance: bigint })[]): AccountTotals => {
  let available = 0n;
  let netWorth = 0n;
  for (const account of accounts) {
    if (account.archivedAt !== null) continue;
    const switches = switchesOf(account);
    if (switches.includeInAvailable) available += account.balance;
    if (switches.includeInNetWorth) netWorth += account.balance;
  }
  return { available, netWorth };
};
