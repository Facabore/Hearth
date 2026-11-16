import type { SpaceLocks } from "@/modules/spaces/application";
import {
  currencyOf,
  domainError,
  err,
  ExchangeRate,
  Money,
  ok,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import type { Account } from "../domain/account";
import { accountForChange } from "./account-for-change";
import { todayFor, withBalances, type AccountView } from "./account-view";
import type { AccountsDeps } from "./deps";

/**
 * Ruling P336: what the account's movements moved it by, converted into its new currency. The accounts module declares
 * it and the composition root binds it to the ledger, which owns the movements (ADR 0001).
 */
export interface AccountMoneyConversion {
  convert(input: {
    readonly accountId: string;
    readonly accountSpaceId: string;
    readonly from: string;
    readonly to: string;
    readonly rate: ExchangeRate | null;
    readonly actorUserId: string;
    readonly dryRun: boolean;
  }): Promise<
    Result<{ readonly movements: number; readonly netBefore: bigint; readonly netAfter: bigint | null }>
  >;
}

export interface ChangeAccountCurrencyDeps extends AccountsDeps {
  readonly conversion: AccountMoneyConversion;
  /** Ruling P336: the account's space is held as a currency change holds it, so no money write lands meanwhile. */
  readonly lifecycleLocks: Pick<SpaceLocks, "lockForLifecycle">;
}

interface CurrencyChangeInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly accountId: string;
  /** The new currency, ISO 4217. */
  readonly currency: string;
}

/** Ruling P336: what changing the account's currency would do, at the given rate or the latest stored one. */
export interface CurrencyChangePreview {
  readonly from: string;
  readonly to: string;
  /** The rate used: the one given, else the latest stored on or before today; null when there is none. */
  readonly rate: string | null;
  /** The day of the stored rate offered; null when the rate was given or there is none. */
  readonly rateDate: LocalDate | null;
  /** The live movements whose amount in the account converts. */
  readonly movements: number;
  readonly balanceBefore: Money;
  /** Null without a rate. */
  readonly balanceAfter: Money | null;
}

export type PreviewAccountCurrency = (
  input: CurrencyChangeInput & { readonly rate?: string },
) => Promise<Result<CurrencyChangePreview>>;

export type ChangeAccountCurrency = (
  input: CurrencyChangeInput & { readonly rate: string },
) => Promise<Result<AccountView>>;

/** The new currency, which must be another one than the account's, and the rate typed, when there is one. */
const target = (account: Account, currency: string, rate: string | undefined) => {
  const code = currencyOf(currency);
  if (!code.ok) return code;
  if (code.value.code === account.currency) return err(domainError("CurrencyUnchanged"));
  if (rate === undefined) return ok({ to: code.value.code, rate: null });
  const parsed = ExchangeRate.of(account.currency, code.value.code, rate);
  return parsed.ok ? ok({ to: code.value.code, rate: parsed.value }) : parsed;
};

/** `minor` of the account's currency in the new one; zero and nothing stay as they are. */
const convertedMinor = (minor: bigint, from: string, rate: ExchangeRate): Result<bigint> => {
  if (minor === 0n) return ok(0n);
  const money = Money.ofMinor(minor, from);
  if (!money.ok) return money;
  const converted = money.value.convert(rate);
  return converted.ok ? ok(converted.value.minor) : converted;
};

const convertedOrNull = (minor: bigint | null, from: string, rate: ExchangeRate): Result<bigint | null> =>
  minor === null ? ok(null) : convertedMinor(minor, from, rate);

/** Ruling P336: the account in its new currency, its opening balance and its amounts in terms converted. */
const inCurrency = (account: Account, to: string, rate: ExchangeRate): Result<Account> => {
  const opening = convertedMinor(account.openingBalance, account.currency, rate);
  if (!opening.ok) return opening;
  const creditLimit = convertedOrNull(account.terms.creditLimit, account.currency, rate);
  if (!creditLimit.ok) return creditLimit;
  const principal = convertedOrNull(account.terms.principal, account.currency, rate);
  if (!principal.ok) return principal;
  return ok({
    ...account,
    currency: to,
    openingBalance: opening.value,
    terms: { ...account.terms, creditLimit: creditLimit.value, principal: principal.value },
  });
};

export const createPreviewAccountCurrency =
  (deps: ChangeAccountCurrencyDeps): PreviewAccountCurrency =>
  async (input) => {
    const found = await accountForChange(deps, input);
    if (!found.ok) return found;
    const { account } = found.value;
    const chosen = target(account, input.currency, input.rate);
    if (!chosen.ok) return chosen;
    let rate = chosen.value.rate;
    let rateDate: LocalDate | null = null;
    if (rate === null && deps.rates !== undefined) {
      const stored = await deps.rates.datedRateOn(
        account.currency,
        chosen.value.to,
        await todayFor(deps, input.userId),
      );
      if (stored.ok) ({ rate, date: rateDate } = stored.value);
      else if (stored.error.code !== "NoExchangeRate") return stored;
    }
    const moved = await deps.conversion.convert({
      accountId: account.id,
      accountSpaceId: account.spaceId,
      from: account.currency,
      to: chosen.value.to,
      rate,
      actorUserId: input.userId,
      dryRun: true,
    });
    if (!moved.ok) return moved;
    const before = Money.ofMinor(account.openingBalance + moved.value.netBefore, account.currency);
    if (!before.ok) return before;
    let after: Money | null = null;
    if (rate !== null && moved.value.netAfter !== null) {
      const converted = inCurrency(account, chosen.value.to, rate);
      if (!converted.ok) return converted;
      const money = Money.ofMinor(converted.value.openingBalance + moved.value.netAfter, chosen.value.to);
      if (!money.ok) return money;
      after = money.value;
    }
    return ok({
      from: account.currency,
      to: chosen.value.to,
      rate: rate?.value ?? null,
      rateDate,
      movements: moved.value.movements,
      balanceBefore: before.value,
      balanceAfter: after,
    });
  };

export const createChangeAccountCurrency =
  (deps: ChangeAccountCurrencyDeps): ChangeAccountCurrency =>
  (input) =>
    deps.tm.run(async () => {
      // Ruling P336: before the membership, as every money write (#89); held FOR NO KEY UPDATE, so no movement of the
      // account's space is recorded in its old currency while it changes.
      await deps.lifecycleLocks.lockForLifecycle(input.spaceId);
      const found = await accountForChange(deps, input);
      if (!found.ok) return found;
      const { account } = found.value;
      const chosen = target(account, input.currency, input.rate);
      if (!chosen.ok) return chosen;
      const rate = chosen.value.rate;
      if (rate === null) return err(domainError("InvalidExchangeRate"));
      const changed = inCurrency(account, chosen.value.to, rate);
      if (!changed.ok) return changed;
      // The movements first: they are read while the account still has its old currency, which their audit names.
      const moved = await deps.conversion.convert({
        accountId: account.id,
        accountSpaceId: account.spaceId,
        from: account.currency,
        to: chosen.value.to,
        rate,
        actorUserId: input.userId,
        dryRun: false,
      });
      if (!moved.ok) return moved;
      await deps.accounts.saveCurrency(changed.value);
      const [view] = await withBalances(
        deps.movements,
        [changed.value],
        null,
        await todayFor(deps, input.userId),
      );
      return ok(view!);
    });
