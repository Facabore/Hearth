import {
  currencyOf,
  flatMap,
  map,
  Money,
  type ExchangeRate,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import { switchesOf, type Account } from "./account";

/** HU-E2-07, D21: a space's "Disponible" and "Patrimonio neto", in minor units of its currency. */
export interface AccountTotals {
  readonly available: bigint;
  readonly netWorth: bigint;
}

/** D29 (MC4): a rate from one account currency into the space's, with the stored rate's day and its staleness. */
export interface ConversionRate {
  readonly rate: ExchangeRate;
  readonly date: LocalDate;
  readonly stale: boolean;
}

/** D29 (MC4, board 8): how the totals converted the accounts in other currencies. */
export interface TotalsConversion {
  /** Each converted account's balance in the space's currency, by account id. */
  readonly converted: ReadonlyMap<string, bigint>;
  /** Each currency that was converted: its rate, one of its units in the space's minor units, and the rate's day. */
  readonly rates: readonly (ConversionRate & { readonly currency: string; readonly unit: bigint })[];
  /** Active accounts in another currency with no rate: left out of the totals, never counted at 1:1. */
  readonly withoutRate: readonly string[];
}

const convert = (minor: bigint, currency: string, rate: ExchangeRate): Result<bigint> =>
  map(
    flatMap(Money.ofMinor(minor, currency), (money) => money.convert(rate)),
    (money) => money.minor,
  );

/**
 * HU-E2-07, rulings P51 and P53: Σ signed balances of the active accounts with each switch (liabilities are negative,
 * so net worth is assets minus debts); archived accounts never count. Computed on read (D7).
 *
 * D29, slice MC4 (design §4.1): an account in another currency keeps its exact balance in its own currency, and the
 * totals convert it into the space's `baseCurrency` with `rates` (keyed by the account's currency), through
 * `Money.convert` only. An account whose currency has no rate is left out and reported in `withoutRate`.
 */
export const convertedTotalsOf = (
  accounts: readonly (Account & { readonly balance: bigint })[],
  baseCurrency: string,
  rates: ReadonlyMap<string, ConversionRate>,
): { readonly totals: AccountTotals; readonly conversion: TotalsConversion } => {
  let available = 0n;
  let netWorth = 0n;
  const converted = new Map<string, bigint>();
  const used = new Map<string, TotalsConversion["rates"][number]>();
  const withoutRate: string[] = [];
  for (const account of accounts) {
    if (account.archivedAt !== null) continue;
    let balance = account.balance;
    if (account.currency !== baseCurrency) {
      const rate = rates.get(account.currency);
      const value = rate === undefined ? undefined : convert(account.balance, account.currency, rate.rate);
      const unit =
        rate === undefined
          ? undefined
          : flatMap(currencyOf(account.currency), (c) =>
              convert(10n ** BigInt(c.exponent), c.code, rate.rate),
            );
      if (rate === undefined || !value?.ok || !unit?.ok) {
        withoutRate.push(account.id);
        continue;
      }
      balance = value.value;
      converted.set(account.id, balance);
      used.set(account.currency, { currency: account.currency, ...rate, unit: unit.value });
    }
    const switches = switchesOf(account);
    if (switches.includeInAvailable) available += balance;
    if (switches.includeInNetWorth) netWorth += balance;
  }
  const byCurrency = [...used.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1));
  return { totals: { available, netWorth }, conversion: { converted, rates: byCurrency, withoutRate } };
};

/** HU-E2-07: the totals with no rate at hand, so an account in another currency is left out (D29). */
export const totalsOf = (
  accounts: readonly (Account & { readonly balance: bigint })[],
  baseCurrency: string,
): AccountTotals => convertedTotalsOf(accounts, baseCurrency, new Map()).totals;
