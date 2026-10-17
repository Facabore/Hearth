import { todayIn, type LocalDate } from "@/shared/kernel";
import type { Account } from "../domain/account";
import { termFigures, type TermFigures } from "../domain/account-terms";
import type { AccountMovements } from "./account-movements";
import type { AccountsDeps } from "./deps";

/** An account with its balance computed on read (D7): opening balance plus net movements, and what its terms say. */
export interface AccountView extends Account {
  readonly currency: string;
  readonly balance: bigint;
  /** HU-E2-06: derived with today in the requester's zone. */
  readonly figures: TermFigures;
}

/** HU-E1-14, ruling P55: the requester's local date. */
export const todayFor = async (deps: Pick<AccountsDeps, "clock" | "userTimeZones">, userId: string) =>
  todayIn(deps.clock, await deps.userTimeZones.timeZoneOf(userId));

export const toView = (account: Account, currency: string, today: LocalDate, net = 0n): AccountView => {
  const balance = account.openingBalance + net;
  return { ...account, currency, balance, figures: termFigures(account.terms, balance, today) };
};

export const withBalances = async (
  movements: AccountMovements,
  accounts: readonly Account[],
  currency: string,
  asOf: LocalDate | null,
  today: LocalDate,
): Promise<AccountView[]> => {
  if (accounts.length === 0) return [];
  const net = await movements.netMovements(
    accounts.map((a) => a.id),
    asOf,
  );
  return accounts.map((a) => toView(a, currency, today, net.get(a.id) ?? 0n));
};
