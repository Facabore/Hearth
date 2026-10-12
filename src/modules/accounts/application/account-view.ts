import type { LocalDate } from "@/shared/kernel";
import type { Account } from "../domain/account";
import type { AccountMovements } from "./account-movements";

/** An account with its balance computed on read (D7): opening balance plus net movements. */
export interface AccountView extends Account {
  readonly currency: string;
  readonly balance: bigint;
}

export const toView = (account: Account, currency: string, net = 0n): AccountView => ({
  ...account,
  currency,
  balance: account.openingBalance + net,
});

export const withBalances = async (
  movements: AccountMovements,
  accounts: readonly Account[],
  currency: string,
  asOf: LocalDate | null,
): Promise<AccountView[]> => {
  if (accounts.length === 0) return [];
  const net = await movements.netMovements(
    accounts.map((a) => a.id),
    asOf,
  );
  return accounts.map((a) => toView(a, currency, net.get(a.id) ?? 0n));
};
