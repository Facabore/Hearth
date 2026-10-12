import { domainError, err, flatMap, todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordTransfer, type Transfer } from "../domain/transaction";
import { accountInSpace, authorizeWriter, inSpaceCurrency, openPeriod, ownAccount } from "./checks";
import type { LedgerDeps } from "./deps";

export interface RecordTransferInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
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
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
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
        now: deps.clock.now(),
        sourceAccountId: source.value.id,
        destinationAccountId: destination.value.id,
      });
      if (!transfer.ok) return transfer;
      await deps.transactions.add(transfer.value);
      return transfer;
    });
