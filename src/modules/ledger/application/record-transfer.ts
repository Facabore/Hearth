import { domainError, err, flatMap, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordTransfer, type Transfer } from "../domain/transaction";
import { accountInSpace, authorizeWriter, openPeriod, ownAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import { convertedAt } from "./foreign-amount";
import { whenOf, type WhenInput } from "./when";

export interface RecordTransferInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  /** D29, slice MC3: what LEAVES the source account ("Sale"), in the source account's own currency. */
  readonly amount: Money;
  /**
   * D29, section 4.1: what ARRIVES at the destination account ("Llega"), in the destination account's own currency,
   * when it differs from the source's. Suggested from the rate; when given, it wins. Absent when both accounts share a
   * currency, or when the destination amount follows the rate.
   */
  readonly destinationAmount?: Money;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
}

export type RecordTransfer = (input: RecordTransferInput) => Promise<Result<Transfer>>;

/** HU-E4-03: moves money between the requester's own accounts; never spending. */
export const createRecordTransfer =
  (deps: LedgerDeps): RecordTransfer =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      if (input.sourceAccountId === input.destinationAccountId)
        return err(domainError("SameAccountTransfer"));
      const usable = async (accountId: string) =>
        flatMap(await ownAccount(deps, accountId, input.userId), (a) => accountInSpace(a, space.spaceId));
      const source = await usable(input.sourceAccountId);
      if (!source.ok) return source;
      const destination = await usable(input.destinationAccountId);
      if (!destination.ok) return destination;
      // D29, section 4.1: "Sale" is in the source account's own currency; "Llega", when given, in the destination's.
      const sourceCurrency = source.value.currency;
      const destinationCurrency = destination.value.currency;
      if (input.amount.currency.code !== sourceCurrency) {
        return err(
          domainError("CurrencyMismatch", { expected: sourceCurrency, actual: input.amount.currency.code }),
        );
      }
      if (
        input.destinationAmount !== undefined &&
        input.destinationAmount.currency.code !== destinationCurrency
      ) {
        return err(
          domainError("CurrencyMismatch", {
            expected: destinationCurrency,
            actual: input.destinationAmount.currency.code,
          }),
        );
      }
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      // D29, section 4.1: the amounts are decided at recording; the rate lookups are reads inside the held lock (#89).
      const resolved = await resolveAmounts(
        deps,
        space.currency,
        input,
        sourceCurrency,
        destinationCurrency,
        date,
      );
      if (!resolved.ok) return resolved;
      const { base, arrive } = resolved.value;
      // D29: a leg is stored only when its account's currency differs from the base; then it is in that currency.
      const sourceLeg = sourceCurrency === space.currency ? undefined : input.amount.minor;
      const destinationLeg = destinationCurrency === space.currency ? undefined : arrive.minor;
      const transfer = recordTransfer({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: base.minor,
        currency: space.currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        sourceAccountId: source.value.id,
        destinationAccountId: destination.value.id,
        ...(sourceLeg === undefined ? {} : { sourceAmount: sourceLeg, sourceCurrency }),
        ...(destinationLeg === undefined ? {} : { destinationAmount: destinationLeg, destinationCurrency }),
      });
      if (!transfer.ok) return transfer;
      await deps.transactions.add(transfer.value);
      return transfer;
    });

/**
 * D29, section 4.1 (approved for slice MC3). Let B be the space's base currency, S the source currency and D the
 * destination's. `arrive` is what reaches the destination (in D): the amount when S === D, else the given
 * `destinationAmount`, else the rate's conversion. `base` is what the row stores (in B): the amount when S === B, the
 * arriving amount when D === B, else the amount converted at the S→B rate. When the currencies match, the given
 * destination amount must equal the amount (InvalidTransferAmounts); when they do not, no rate is ExchangeRateRequired.
 */
export const resolveAmounts = async (
  deps: Pick<LedgerDeps, "rates">,
  base: string,
  input: RecordTransferInput,
  sourceCurrency: string,
  destinationCurrency: string,
  date: LocalDate,
): Promise<Result<{ readonly base: Money; readonly arrive: Money }>> => {
  // What arrives at the destination, in its own currency.
  let arrive: Money;
  if (sourceCurrency === destinationCurrency) {
    if (input.destinationAmount !== undefined && input.destinationAmount.minor !== input.amount.minor) {
      return err(domainError("InvalidTransferAmounts"));
    }
    arrive = input.amount;
  } else if (input.destinationAmount !== undefined) {
    arrive = input.destinationAmount;
  } else {
    const converted = await convertedAt(deps, input.amount, destinationCurrency, date);
    if (!converted.ok) return converted;
    arrive = converted.value;
  }
  // The stored base amount, in the space's base currency.
  if (sourceCurrency === base) return ok({ base: input.amount, arrive });
  if (destinationCurrency === base) return ok({ base: arrive, arrive });
  const converted = await convertedAt(deps, input.amount, base, date);
  if (!converted.ok) return converted;
  return ok({ base: converted.value, arrive });
};
