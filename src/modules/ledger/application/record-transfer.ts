import { domainError, err, flatMap, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordTransfer, type Transfer } from "../domain/transaction";
import { accountInSpace, authorizeWriter, inSpaceCurrency, openPeriod, ownAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import { whenOf, type WhenInput } from "./when";

export interface RecordTransferInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly amount: Money;
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
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      if (input.sourceAccountId === input.destinationAccountId)
        return err(domainError("SameAccountTransfer"));
      const usable = async (accountId: string) =>
        flatMap(await ownAccount(deps, accountId, input.userId), (a) => accountInSpace(a, space.spaceId));
      const source = await usable(input.sourceAccountId);
      if (!source.ok) return source;
      const destination = await usable(input.destinationAccountId);
      if (!destination.ok) return destination;
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const transfer = recordTransfer({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        sourceAccountId: source.value.id,
        destinationAccountId: destination.value.id,
      });
      if (!transfer.ok) return transfer;
      await deps.transactions.add(transfer.value);
      return transfer;
    });
