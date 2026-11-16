import type { AccountDto } from "@/shared/ui/api/dto";
import { formatNumber, type Formats } from "@/shared/ui/format/formatters";
import type { AccountType } from "./account-look";

export { colorOf, TYPE_COLORS } from "./account-look";

/** Ruling P131: the Accounts screen's sections, in their order. */
export const ACCOUNT_SECTIONS = [
  { key: "everyday", types: ["BANK", "WALLET", "CASH"] },
  { key: "cards", types: ["CREDIT_CARD"] },
  { key: "savings", types: ["SAVINGS", "INVESTMENT"] },
  { key: "debts", types: ["LOAN"] },
  { key: "other", types: ["OTHER"] },
  { key: "funds", types: ["SHARED_FUND"] },
] as const satisfies readonly { key: string; types: readonly AccountType[] }[];
export type SectionKey = (typeof ACCOUNT_SECTIONS)[number]["key"];

/** A group of active accounts that share a currency other than the space's (D29, slice MC3). */
export interface ForeignCurrencyGroup {
  readonly currency: string;
  readonly accounts: AccountDto[];
}

/**
 * Active accounts by section (empty ones dropped, the API's order kept) and the archived ones apart.
 *
 * D29, slice MC3: the type sections hold only the accounts in the space's `baseCurrency`, so a section total never adds
 * amounts of different currencies. Accounts in another currency are grouped apart under their own currency (`foreign`),
 * and the screen lists them below the space totals, which leave them out until MC4 converts them.
 */
export const sectionsOf = (
  items: readonly AccountDto[],
  baseCurrency: string,
): {
  active: { key: SectionKey; accounts: AccountDto[] }[];
  foreign: ForeignCurrencyGroup[];
  archived: AccountDto[];
} => {
  const live = items.filter((a) => a.archivedAt === null);
  const base = live.filter((a) => a.balance.currency === baseCurrency);
  const other = live.filter((a) => a.balance.currency !== baseCurrency);
  const currencies = [...new Set(other.map((a) => a.balance.currency))].sort((x, y) => x.localeCompare(y));
  return {
    active: ACCOUNT_SECTIONS.map(({ key, types }) => ({
      key,
      accounts: base.filter((a) => (types as readonly AccountType[]).includes(a.type)),
    })).filter((s) => s.accounts.length > 0),
    foreign: currencies.map((currency) => ({
      currency,
      accounts: other.filter((a) => a.balance.currency === currency),
    })),
    archived: items.filter((a) => a.archivedAt !== null),
  };
};

/**
 * Board B1 · 07 (P292): a section's total, the sum of the balances the API gave its accounts (one space, one currency);
 * nothing is computed here beyond that sum.
 */
export const totalOf = (accounts: readonly AccountDto[]): AccountDto["balance"] => ({
  amount: accounts.reduce((sum, account) => sum + BigInt(account.balance.amount), 0n).toString(),
  currency: accounts[0]!.balance.currency,
});

/** "11.2000" → "11,2": trailing zeros and a bare point dropped, then the person's number format. */
export const rateText = (rate: string, formats: Pick<Formats, "numberFormat">): string =>
  formatNumber(rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate, formats);
