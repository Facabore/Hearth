import type { AccountDto } from "@/shared/ui/api/dto";
import { safeStorage } from "./safe-storage";

const KEY = "hearth.lastAccount";

/**
 * Issue #208: the account this browser last paid an expense from, or null; a blocked storage reads as none. One key for
 * every space, because a shared expense is paid from the recorder's personal accounts too.
 */
export const readLastAccount = (storage: Storage | undefined = safeStorage()): string | null => {
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
};

/** Remembers the account an expense was paid from; a full or blocked storage only loses the convenience. */
export const rememberLastAccount = (
  accountId: string,
  storage: Storage | undefined = safeStorage(),
): void => {
  try {
    storage?.setItem(KEY, accountId);
  } catch {
    // Nothing to do: the next form starts on its fallback.
  }
};

const minorOf = (account: { readonly balance?: AccountDto["balance"] }): bigint =>
  BigInt(account.balance?.amount ?? "0");

/** A missing balance reads as zero in any currency; two balances compare only in the same one. */
const sameCurrency = (
  a: { readonly balance?: AccountDto["balance"] },
  b: { readonly balance?: AccountDto["balance"] },
): boolean => a.balance === undefined || b.balance === undefined || a.balance.currency === b.balance.currency;

/**
 * The account a new movement starts on (issue #208): the one last paid from while the form still offers it. Else, #285
 * (audit pass 3, A8): where the money is, the non-savings account with the highest balance (list order breaks a tie),
 * so a new person who loaded Efectivo does not start on "Billetera digital" by alphabetical accident; else the first.
 * Never a savings account for its balance alone.
 */
export const preferredAccountId = (
  accounts: readonly (Pick<AccountDto, "id" | "type"> & { readonly balance?: AccountDto["balance"] })[],
  lastAccountId: string | null,
): string | null =>
  (
    accounts.find((a) => a.id === lastAccountId) ??
    accounts
      .filter((a) => a.type !== "SAVINGS")
      .reduce<(typeof accounts)[number] | undefined>(
        // A balance is compared only with one in its own currency: list order decides across currencies.
        (best, a) => (best === undefined || (sameCurrency(a, best) && minorOf(a) > minorOf(best)) ? a : best),
        undefined,
      ) ??
    accounts[0]
  )?.id ?? null;
