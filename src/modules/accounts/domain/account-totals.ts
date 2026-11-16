import { switchesOf, type Account } from "./account";

/** HU-E2-07, D21: a space's "Disponible" and "Patrimonio neto", in minor units of its currency. */
export interface AccountTotals {
  readonly available: bigint;
  readonly netWorth: bigint;
}

/**
 * HU-E2-07, rulings P51 and P53: Σ signed balances of the active accounts with each switch (liabilities are negative,
 * so net worth is assets minus debts); archived accounts never count. Computed on read (D7).
 *
 * D29, slice MC3: a space's totals never add amounts of different currencies. Until MC4 converts them on read, an
 * account whose currency is not the space's `baseCurrency` is left out and listed apart under its own currency.
 */
export const totalsOf = (
  accounts: readonly (Account & { readonly balance: bigint })[],
  baseCurrency: string,
): AccountTotals => {
  let available = 0n;
  let netWorth = 0n;
  for (const account of accounts) {
    if (account.archivedAt !== null) continue;
    if (account.currency !== baseCurrency) continue;
    const switches = switchesOf(account);
    if (switches.includeInAvailable) available += account.balance;
    if (switches.includeInNetWorth) netWorth += account.balance;
  }
  return { available, netWorth };
};
