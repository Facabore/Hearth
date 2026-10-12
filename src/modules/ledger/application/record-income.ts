import { flatMap, todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
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

export interface RecordIncomeInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
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
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
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
        now: deps.clock.now(),
        categoryId: category.value,
        destinationAccountId: account.value.id,
        receivingMemberId: space.memberId,
      });
      if (!income.ok) return income;
      await deps.transactions.add(income.value);
      return income;
    });
