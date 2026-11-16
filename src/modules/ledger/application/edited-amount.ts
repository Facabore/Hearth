import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, Money, ok, type LocalDate, type Result } from "@/shared/kernel";
import type { Transaction } from "../domain/transaction";
import { inSpaceCurrency } from "./checks";
import type { LedgerDeps } from "./deps";
import type { EditChanges } from "./edited-parts";
import { baseAmountOf, convertedAt } from "./foreign-amount";
import { resolveAmounts } from "./record-transfer";

/** D29, section 4.1: a new amount as recording reads it. */
export interface EditedAmount {
  /** The base amount the row stores, in the space's base currency. */
  readonly base: Money;
  /** What was entered when it is not in the base currency; null when it is (the row keeps no original). */
  readonly original: { readonly amount: bigint; readonly currency: string } | null;
  /** The amounts the edit gives in an account's own currency, which that account's leg takes as they are. */
  readonly known: readonly Money[];
}

/**
 * D29: the amount an edit's `convertedAmount` or `destinationAmount` sent alone goes with: what a foreign expense or
 * income was entered in, or an own transfer's "Sale" (its source leg, else the base amount). `destinationAmount` fits
 * an own transfer only (InvalidTransferLeg) and `convertedAmount` a foreign expense or income only
 * (InvalidOriginalAmount); null when the edit sends none of the three.
 */
const amountOf = (current: Transaction, changes: EditChanges): Result<Money | null> => {
  const ownTransfer = current.type === "TRANSFER" && current.payerMemberId === null;
  const entered = current.type === "EXPENSE" || current.type === "INCOME";
  if (changes.destinationAmount !== undefined && !ownTransfer) return err(domainError("InvalidTransferLeg"));
  if (changes.convertedAmount !== undefined && !entered) return err(domainError("InvalidOriginalAmount"));
  if (changes.amount !== undefined) return ok(changes.amount);
  if (changes.convertedAmount !== undefined) {
    if (current.originalAmount === undefined || current.originalCurrency === undefined) {
      return err(domainError("InvalidOriginalAmount"));
    }
    return Money.ofMinor(current.originalAmount, current.originalCurrency);
  }
  if (changes.destinationAmount === undefined || current.type !== "TRANSFER") return ok(null);
  return current.sourceAmount === undefined || current.sourceCurrency === undefined
    ? Money.ofMinor(current.amount, current.currency)
    : Money.ofMinor(current.sourceAmount, current.sourceCurrency);
};

/**
 * D29, sections 4.1 and 4.2: an edit's new `amount` read by the rules of recording its type, at the edited date's rate;
 * null when the edit sends no amount nor what goes with one (`amountOf`). An expense or income takes
 * any currency and keeps the original (the converted amount wins over the rate); an own transfer's amount is "Sale" in
 * the source account's currency, with "Llega" given or at the rate; an adjustment's is in its account's currency, its
 * size only (positive, its direction kept); a fund contribution or settlement stays in the base.
 */
export const editedAmountOf = async (
  deps: Pick<LedgerDeps, "accounts" | "rates">,
  space: SpaceMembership,
  current: Transaction,
  changes: EditChanges,
  date: LocalDate,
): Promise<Result<EditedAmount | null>> => {
  const sent = amountOf(current, changes);
  if (!sent.ok) return sent;
  if (sent.value === null) return ok(null);
  const amount = sent.value;
  if (current.type === "EXPENSE" || current.type === "INCOME") {
    const base = await baseAmountOf(deps, space, amount, changes.convertedAmount, date);
    if (!base.ok) return base;
    const original = base.value.original ?? null;
    return ok({ base: base.value.base, original, known: original === null ? [] : [amount] });
  }
  if (current.type === "TRANSFER" && current.payerMemberId === null) {
    const currencyOf = async (accountId: string | null) =>
      accountId === null
        ? space.currency
        : ((await deps.accounts.find(accountId))?.currency ?? space.currency);
    const sourceCurrency = await currencyOf(changes.sourceAccountId ?? current.sourceAccountId);
    const destinationCurrency = await currencyOf(
      changes.destinationAccountId ?? current.destinationAccountId,
    );
    if (amount.currency.code !== sourceCurrency) {
      return err(domainError("CurrencyMismatch", { expected: sourceCurrency, actual: amount.currency.code }));
    }
    const arriving = changes.destinationAmount;
    if (arriving !== undefined && arriving.currency.code !== destinationCurrency) {
      return err(
        domainError("CurrencyMismatch", { expected: destinationCurrency, actual: arriving.currency.code }),
      );
    }
    const resolved = await resolveAmounts(
      deps,
      space.currency,
      { amount, destinationAmount: arriving },
      sourceCurrency,
      destinationCurrency,
      date,
    );
    if (!resolved.ok) return resolved;
    return ok({ base: resolved.value.base, original: null, known: [amount, resolved.value.arrive] });
  }
  if (current.type === "ADJUSTMENT") {
    // Design Q4: the new size of the adjustment, in its account's own currency; its direction stays as recorded.
    const accountId = current.destinationAccountId ?? current.sourceAccountId;
    const currency =
      (accountId === null ? null : (await deps.accounts.find(accountId))?.currency) ?? space.currency;
    if (amount.currency.code !== currency) {
      return err(domainError("CurrencyMismatch", { expected: currency, actual: amount.currency.code }));
    }
    if (currency === space.currency) return ok({ base: amount, original: null, known: [] });
    const converted = await convertedAt(deps, amount, space.currency, date);
    if (!converted.ok) return converted;
    return ok({ base: converted.value, original: null, known: [amount] });
  }
  const base = inSpaceCurrency(space, amount);
  if (!base.ok) return base;
  return ok({ base: base.value, original: null, known: [] });
};
