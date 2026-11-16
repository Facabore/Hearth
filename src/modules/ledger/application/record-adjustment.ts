import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, flatMap, Money, ok, type Result } from "@/shared/kernel";
import { recordAdjustment, withLegs, type Adjustment } from "../domain/transaction";
import { accountInSpace, authorizeWriter, fundAccount, openPeriod, ownAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import { accountLegOf, convertedAt } from "./foreign-amount";
import type { LedgerAccount } from "./ports";
import { whenOf, type WhenInput } from "./when";

export interface RecordAdjustmentInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  /** Signed, in the account's own currency: positive for money in, negative for money out; never zero. */
  readonly amount: Money;
  /** The requester's own account in this space, or the space's shared fund for an OWNER or ADMIN. */
  readonly accountId: string;
}

export type RecordAdjustment = (input: RecordAdjustmentInput) => Promise<Result<Adjustment>>;

/**
 * D9, design Q4: the account an adjustment may move. A person adjusts their own accounts in the space; the space's
 * shared fund belongs to nobody, so only an OWNER or ADMIN adjusts it (anyone else is AccountNotOwned).
 */
const adjustableAccount = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  accountId: string,
  userId: string,
): Promise<Result<LedgerAccount>> => {
  const found = await deps.accounts.find(accountId);
  if (found?.isSharedFund === true && found.spaceId === space.spaceId) {
    if (space.role !== "OWNER" && space.role !== "ADMIN") return err(domainError("AccountNotOwned"));
    return fundAccount(deps, accountId, space.spaceId);
  }
  return flatMap(await ownAccount(deps, accountId, userId), (a) => accountInSpace(a, space.spaceId));
};

/**
 * Design Q4, gap G1 (#329): a balance adjustment ("Ajuste de saldo") of one account. It moves that account's balance by
 * the signed amount, in the account's own currency (its leg, D29 section 4.1), and nothing else: never spending or
 * income, no category, payer or split. The base amount the row stores is the amount itself in an account of the base
 * currency, else its conversion at the date's rate (ExchangeRateRequired without one).
 */
export const createRecordAdjustment =
  (deps: LedgerDeps): RecordAdjustment =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      if (input.amount.minor === 0n) return err(domainError("InvalidAmount", { amount: "0" }));
      const account = await adjustableAccount(deps, space, input.accountId, input.userId);
      if (!account.ok) return account;
      if (input.amount.currency.code !== account.value.currency) {
        return err(
          domainError("CurrencyMismatch", {
            expected: account.value.currency,
            actual: input.amount.currency.code,
          }),
        );
      }
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const direction = input.amount.minor > 0n ? "IN" : "OUT";
      const magnitude = Money.ofMinor(
        direction === "IN" ? input.amount.minor : -input.amount.minor,
        input.amount.currency.code,
      );
      if (!magnitude.ok) return magnitude;
      // D29, section 4.1: the base amount, in the space's base currency; a rate lookup is a read inside the lock (#89).
      const base =
        account.value.currency === space.currency
          ? ok(magnitude.value)
          : await convertedAt(deps, magnitude.value, space.currency, date);
      if (!base.ok) return base;
      // D29: the account's leg is what was entered, whenever the account is not in the base currency.
      const leg = await accountLegOf(deps, space, account.value.id, base.value, [magnitude.value], date);
      if (!leg.ok) return leg;
      const adjustment = recordAdjustment({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: base.value.minor,
        currency: space.currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        accountId: account.value.id,
        direction,
      });
      if (!adjustment.ok) return adjustment;
      const legged = withLegs(
        adjustment.value,
        direction === "IN" ? { destination: leg.value } : { source: leg.value },
      ) as Result<Adjustment>;
      if (!legged.ok) return legged;
      await deps.transactions.add(legged.value);
      return legged;
    });
