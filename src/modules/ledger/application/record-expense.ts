import { todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordExpense, type Expense } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency, openPeriod, ownAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

export interface RecordExpenseInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount: Money;
  /** The requester's own account the money left from. */
  readonly accountId: string;
}

export type RecordExpense = (input: RecordExpenseInput) => Promise<Result<Expense>>;

/**
 * HU-E4-01: a personal expense is a shared expense with one participant (D2): one payment by the
 * requester from their own account and one EQUAL share for them. HU-E4-07 adds payments[] and splits.
 */
export const createRecordExpense =
  (deps: LedgerDeps): RecordExpense =>
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
      const account = await ownAccount(deps, input.accountId, input.userId);
      if (!account.ok) return account;
      const date = input.date ?? todayIn(deps.clock, deps.timeZone);
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const expense = recordExpense({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        now: deps.clock.now(),
        categoryId: category.value,
        payments: [{ memberId: space.memberId, accountId: account.value.id, amount: amount.value }],
        shares: [{ memberId: space.memberId, amount: amount.value, splitMethod: "EQUAL" }],
      });
      if (!expense.ok) return expense;
      await deps.transactions.add(expense.value);
      return expense;
    });
