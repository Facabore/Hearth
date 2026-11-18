import { domainError, err, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import type { Transaction } from "../domain/transaction";
import { inCurrency } from "./checks";
import type { LedgerDeps } from "./deps";
import type { EditChanges } from "./edited-parts";
import { convertedAt } from "./foreign-amount";
import { resolveAmounts } from "./record-transfer";

/** What an edit sends about money: the parts' own `EditChanges` and what an account moved (P342). */
export type AmountChanges = Pick<
  EditChanges,
  "amount" | "convertedAmount" | "destinationAmount" | "sourceAccountId" | "destinationAccountId"
> & {
  /**
   * P342 (S3): what the paying or receiving account really moved, in the account's own currency, when that is not the
   * movement's; an expense's with a sole payment, or an income's. When absent, the date's rate decides.
   */
  readonly accountAmount?: Money;
};

/** D29, P342: a new amount as recording reads it. */
export interface EditedAmount {
  /** P342 (S3): the movement's amount, in the currency it is stored in from now on. */
  readonly amount: Money;
  /** What the edit gives in an account's own currency (a transfer's "Sale" and "Llega", an adjustment's size). */
  readonly known: readonly Money[];
  /** P342 (S3): an expense's or income's `accountAmount` (or the deprecated `convertedAmount`), checked by recording. */
  readonly accountAmount?: Money;
}

/**
 * P342: what the account moved, typed: `accountAmount`, else the deprecated `convertedAmount`, which the edit request
 * still sends for the same figure until its contract follows. Each fits an expense or income only, as before
 * (`accountAmount` InvalidTransferLeg, `convertedAmount` InvalidOriginalAmount).
 */
const typedAccountAmount = (current: Transaction, changes: AmountChanges): Result<Money | undefined> => {
  const entered = current.type === "EXPENSE" || current.type === "INCOME";
  if (changes.accountAmount !== undefined && !entered) return err(domainError("InvalidTransferLeg"));
  if (changes.convertedAmount !== undefined && !entered) return err(domainError("InvalidOriginalAmount"));
  return ok(changes.accountAmount ?? changes.convertedAmount);
};

/**
 * D29, P342: the amount an edit's money fields go with: the new `amount`, else the movement's own (what an account moved
 * or what arrived is about the current amount), or an own transfer's "Sale" (its source leg, else the amount).
 * `destinationAmount` fits an own transfer only (InvalidTransferLeg); null when the edit sends no money field.
 */
const amountOf = (
  current: Transaction,
  changes: AmountChanges,
  typed: Money | undefined,
): Result<Money | null> => {
  const ownTransfer = current.type === "TRANSFER" && current.payerMemberId === null;
  if (changes.destinationAmount !== undefined && !ownTransfer) return err(domainError("InvalidTransferLeg"));
  if (changes.amount !== undefined) return ok(changes.amount);
  if (typed !== undefined) return Money.ofMinor(current.amount, current.currency);
  if (changes.destinationAmount === undefined || current.type !== "TRANSFER") return ok(null);
  return current.sourceAmount === undefined || current.sourceCurrency === undefined
    ? Money.ofMinor(current.amount, current.currency)
    : Money.ofMinor(current.sourceAmount, current.sourceCurrency);
};

/**
 * D29 sections 4.1 and 4.2, P342 (S3): an edit's new `amount` read by the rules of recording its type, at the edited
 * date's rate; null when the edit sends no money field (`amountOf`). Nothing converts into the space's currency: an
 * expense or income is stored in the currency of its new amount (the edit decides whether its parts can follow); an
 * own transfer's amount is "Sale" in the source account's currency, with "Llega" given or at the rate, and stays in the
 * movement's own currency; an adjustment's is its size in its account's currency (its direction kept), converted into
 * the movement's own when the account's differs; a fund contribution or settlement keeps the movement's own currency.
 */
export const editedAmountOf = async (
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  current: Transaction,
  changes: AmountChanges,
  date: LocalDate,
): Promise<Result<EditedAmount | null>> => {
  const typed = typedAccountAmount(current, changes);
  if (!typed.ok) return typed;
  const sent = amountOf(current, changes, typed.value);
  if (!sent.ok) return sent;
  if (sent.value === null) return ok(null);
  const amount = sent.value;
  if (current.type === "EXPENSE" || current.type === "INCOME") {
    return ok({ amount, known: [], ...(typed.value === undefined ? {} : { accountAmount: typed.value }) });
  }
  const currencyOf = async (accountId: string | null) =>
    accountId === null
      ? current.currency
      : ((await deps.accounts.find(accountId))?.currency ?? current.currency);
  if (current.type === "TRANSFER" && current.payerMemberId === null) {
    const sourceCurrency = await currencyOf(changes.sourceAccountId ?? current.sourceAccountId);
    const destinationCurrency = await currencyOf(
      changes.destinationAccountId ?? current.destinationAccountId,
    );
    const leaving = inCurrency(sourceCurrency, amount);
    if (!leaving.ok) return leaving;
    const arriving = changes.destinationAmount;
    if (arriving !== undefined) {
      const arrived = inCurrency(destinationCurrency, arriving);
      if (!arrived.ok) return arrived;
    }
    // P342: the transfer stays in its own currency; "Sale" converts into it only when the source account's differs.
    const resolved = await resolveAmounts(
      deps,
      current.currency,
      { amount, destinationAmount: arriving },
      sourceCurrency,
      destinationCurrency,
      date,
    );
    if (!resolved.ok) return resolved;
    return ok({ amount: resolved.value.base, known: [amount, resolved.value.arrive] });
  }
  if (current.type === "ADJUSTMENT") {
    // Design Q4: the new size of the adjustment, in its account's own currency; its direction stays as recorded.
    const size = inCurrency(
      await currencyOf(current.destinationAccountId ?? current.sourceAccountId),
      amount,
    );
    if (!size.ok) return size;
    if (amount.currency.code === current.currency) return ok({ amount, known: [] });
    const converted = await convertedAt(deps, amount, current.currency, date);
    if (!converted.ok) return converted;
    return ok({ amount: converted.value, known: [amount] });
  }
  const own = inCurrency(current.currency, amount);
  if (!own.ok) return own;
  return ok({ amount: own.value, known: [] });
};
