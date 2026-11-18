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
  /**
   * D29, slice MC3: what LEAVES the source account ("Sale"), in the source account's own currency. P342 (S3): the
   * transfer is stored in it.
   */
  readonly amount: Money;
  /**
   * D29, section 4.1: what ARRIVES at the destination account ("Llega"), in the destination account's own currency,
   * when it differs from the source's: the destination's leg. Suggested from the rate; when given, it wins. Absent when
   * both accounts share a currency, or when the destination amount follows the rate.
   */
  readonly destinationAmount?: Money;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
}

export type RecordTransfer = (input: RecordTransferInput) => Promise<Result<Transfer>>;

/**
 * HU-E4-03: moves money between the requester's own accounts; never spending. P342 (S3): stored in the source account's
 * currency, with the destination's leg when its currency differs (D29 section 4.1, relative to the movement's currency).
 */
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
      // P342 (S3): stored in the source's currency, what left; only a destination in another currency keeps a leg, what
      // arrived. The rate lookup is a read inside the held lock (#89).
      const arrive = await arrivingAmount(deps, input, destinationCurrency, date);
      if (!arrive.ok) return arrive;
      const transfer = recordTransfer({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: input.amount.minor,
        currency: sourceCurrency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        sourceAccountId: source.value.id,
        destinationAccountId: destination.value.id,
        ...(destinationCurrency === sourceCurrency
          ? {}
          : { destinationAmount: arrive.value.minor, destinationCurrency }),
      });
      if (!transfer.ok) return transfer;
      await deps.transactions.add(transfer.value);
      return transfer;
    });

/**
 * D29, section 4.1: what reaches the destination, in its own currency: the amount when both accounts share a currency
 * (a given destination amount must equal it, InvalidTransferAmounts), else the given `destinationAmount`, else the
 * amount at the date's rate (ExchangeRateRequired without one).
 */
export const arrivingAmount = async (
  deps: Pick<LedgerDeps, "rates">,
  input: Pick<RecordTransferInput, "amount" | "destinationAmount">,
  destinationCurrency: string,
  date: LocalDate,
): Promise<Result<Money>> => {
  if (input.amount.currency.code === destinationCurrency) {
    return input.destinationAmount !== undefined && input.destinationAmount.minor !== input.amount.minor
      ? err(domainError("InvalidTransferAmounts"))
      : ok(input.amount);
  }
  if (input.destinationAmount !== undefined) return ok(input.destinationAmount);
  return convertedAt(deps, input.amount, destinationCurrency, date);
};

/**
 * D29, section 4.1 (approved for slice MC3), for a transfer stored in currency B (P342: its own, no longer the space's),
 * S its source currency and D its destination's. `arrive` is `arrivingAmount`'s. `base` is what the row stores in B:
 * the amount when S === B, the arriving amount when D === B, else the amount converted at the S→B rate. Recording stores
 * a transfer in S, so it needs only `arrivingAmount`; the edit path uses this.
 */
export const resolveAmounts = async (
  deps: Pick<LedgerDeps, "rates">,
  base: string,
  input: Pick<RecordTransferInput, "amount" | "destinationAmount">,
  sourceCurrency: string,
  destinationCurrency: string,
  date: LocalDate,
): Promise<Result<{ readonly base: Money; readonly arrive: Money }>> => {
  const arrive = await arrivingAmount(deps, input, destinationCurrency, date);
  if (!arrive.ok) return arrive;
  if (sourceCurrency === base) return ok({ base: input.amount, arrive: arrive.value });
  if (destinationCurrency === base) return ok({ base: arrive.value, arrive: arrive.value });
  const converted = await convertedAt(deps, input.amount, base, date);
  if (!converted.ok) return converted;
  return ok({ base: converted.value, arrive: arrive.value });
};
