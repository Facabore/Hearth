import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, type LocalDate, type Result } from "@/shared/kernel";
import {
  convertedTotalsOf,
  type AccountTotals,
  type ConversionRate,
  type TotalsConversion,
} from "../domain/account-totals";
import { todayFor, withBalances, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";
import type { AccountRates } from "./rates";

export type ListAccounts = (input: {
  spaceId: string;
  userId: string;
  includeArchived: boolean;
  asOf?: LocalDate;
}) => Promise<Result<AccountList>>;

/** HU-E2-03/04/07: the accounts with their balances, and the space's totals over its active ones. */
export interface AccountList {
  readonly items: readonly AccountView[];
  /** The space currency, so an empty space still totals 0 in it. */
  readonly currency: string;
  readonly totals: AccountTotals;
  /** D29, slice MC4: how the totals converted the accounts in other currencies, and which had no rate. */
  readonly conversion: TotalsConversion;
}

export type GetAccount = (input: {
  spaceId: string;
  userId: string;
  accountId: string;
  asOf?: LocalDate;
}) => Promise<Result<AccountView>>;

/** HU-E2-03/04: archived accounts only on request; balances computed on read (D7). */
export const createListAccounts =
  (deps: AccountsDeps): ListAccounts =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const accounts = (await deps.accounts.listBySpace(membership.value.spaceId))
      .filter((a) => input.includeArchived || a.archivedAt === null)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
    const today = await todayFor(deps, input.userId);
    const { currency } = membership.value;
    const items = await withBalances(deps.movements, accounts, input.asOf ?? null, today);
    // The totals skip archived accounts, so `includeArchived` never changes them. D29, slice MC4: an active account in
    // another currency converts at the latest rate on or before the day asked for (`asOf`, else today); one with no
    // rate is left out and flagged, never counted at 1:1; any other failure of the rates is answered as it is.
    const rates = await ratesInto(deps.rates, items, currency, input.asOf ?? today);
    if (!rates.ok) return rates;
    return ok({ items, currency, ...convertedTotalsOf(items, currency, rates.value) });
  };

/**
 * The dated rate from each foreign currency of the active accounts into `currency`, on or before `on`. A currency with
 * `NoExchangeRate` is left out of the map (its accounts are flagged); any other error stops the read.
 */
const ratesInto = async (
  rates: AccountRates | undefined,
  items: readonly AccountView[],
  currency: string,
  on: LocalDate,
): Promise<Result<ReadonlyMap<string, ConversionRate>>> => {
  const resolved = new Map<string, ConversionRate>();
  if (rates === undefined) return ok(resolved);
  const foreign = new Set(
    items.filter((a) => a.archivedAt === null && a.currency !== currency).map((a) => a.currency),
  );
  for (const base of foreign) {
    const rate = await rates.datedRateOn(base, currency, on);
    if (rate.ok) resolved.set(base, rate.value);
    else if (rate.error.code !== "NoExchangeRate") return rate;
  }
  return ok(resolved);
};

export const createGetAccount =
  (deps: AccountsDeps): GetAccount =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const account = (await deps.accounts.listBySpace(membership.value.spaceId)).find(
      (a) => a.id === input.accountId,
    );
    if (!account) return err(domainError("AccountNotFound"));
    const [view] = await withBalances(
      deps.movements,
      [account],
      input.asOf ?? null,
      await todayFor(deps, input.userId),
    );
    return ok(view!);
  };
