import { flatMap, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordIncome, type Income } from "../domain/transaction";
import {
  accountInSpace,
  authorizeWriter,
  inSpaceCurrency,
  openPeriod,
  ownAccount,
  usableCategory,
} from "./checks";
import type { LedgerDeps } from "./deps";
import { whenOf, type WhenInput } from "./when";

export interface RecordIncomeInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly categoryId?: string;
  readonly amount: Money;
  /** The requester's own account in this space that receives the money. */
  readonly accountId: string;
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
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
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
      const income = recordIncome({
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
        categoryId: category.value,
        destinationAccountId: account.value.id,
        receivingMemberId: space.memberId,
      });
      if (!income.ok) return income;
      await deps.transactions.add(income.value);
      return income;
    });
