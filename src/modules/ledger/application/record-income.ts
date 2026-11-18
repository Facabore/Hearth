import { flatMap, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordIncome, type Income } from "../domain/transaction";
import { accountInSpace, authorizeWriter, openPeriod, ownAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { recordedLegOf } from "./foreign-amount";
import { whenOf, type WhenInput } from "./when";

export interface RecordIncomeInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly categoryId?: string;
  /** P342 (S3): what was received, in its own currency, which the income keeps. */
  readonly amount: Money;
  /** The requester's own account in this space that receives the money. */
  readonly accountId: string;
  /**
   * P342 (S3): what the account really received, in the account's currency, when that is not `amount`'s; when absent,
   * `amount` at the date's rate.
   */
  readonly accountAmount?: Money;
}

export type RecordIncome = (input: RecordIncomeInput) => Promise<Result<Income>>;

export const createRecordIncome =
  (deps: LedgerDeps): RecordIncome =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const category = await usableCategory(deps, space.spaceId, input.categoryId);
      if (!category.ok) return category;
      const account = flatMap(await ownAccount(deps, input.accountId, input.userId), (a) =>
        accountInSpace(a, space.spaceId),
      );
      if (!account.ok) return account;
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      // P342 (S3): the destination account keeps what it received when it is not in the income's currency; the rate
      // lookup is a read inside the already-held space lock (#89).
      const destination = await recordedLegOf(
        deps,
        account.value.id,
        input.amount,
        input.accountAmount,
        date,
      );
      if (!destination.ok) return destination;
      const income = recordIncome({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: input.amount.minor,
        currency: input.amount.currency.code,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        categoryId: category.value,
        destinationAccountId: account.value.id,
        receivingMemberId: space.memberId,
        destination: destination.value,
      });
      if (!income.ok) return income;
      await deps.transactions.add(income.value);
      return income;
    });
