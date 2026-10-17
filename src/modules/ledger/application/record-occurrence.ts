import { map, type LocalDate, type Money, type Result } from "@/shared/kernel";
import type { Recurrence } from "../domain/recurrence";
import type { Transaction } from "../domain/transaction";
import type { LedgerDeps } from "./deps";
import { createRecordExpense, type LedgerWarning, type RecordExpense } from "./record-expense";
import { createRecordFundContribution, type RecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome, type RecordIncome } from "./record-income";
import { createRecordTransfer, type RecordTransfer } from "./record-transfer";

/** The ledger's record use cases, through which every occurrence is recorded (ruling P21). */
export interface OccurrenceRecorders {
  readonly expense: RecordExpense;
  readonly income: RecordIncome;
  readonly transfer: RecordTransfer;
  readonly fundContribution: RecordFundContribution;
}

export const occurrenceRecorders = (deps: LedgerDeps): OccurrenceRecorders => ({
  expense: createRecordExpense(deps),
  income: createRecordIncome(deps),
  transfer: createRecordTransfer(deps),
  fundContribution: createRecordFundContribution(deps),
});

/** A recorded occurrence: its transaction and, for an expense paid from the fund, FundBalanceNegative (HU-E4-10). */
export interface RecordedOccurrence {
  readonly transaction: Transaction;
  readonly warnings: readonly LedgerWarning[];
}

/**
 * Ruling P21: an occurrence is recorded by the use case a member would call, as `userId`, so every ledger rule
 * applies: the matrix, archived spaces, D9, closed periods and the default split of its date. An expense has the
 * template's one payer paying the whole amount, and the template's split, or none (the default split, ruling P23).
 * The occurrence is only its `date`, with no time, and the ledger's answer, a refusal included, is returned as is.
 *
 * It writes only the transaction, so the caller owns the rest of the guarantee (one occurrence, one transaction):
 * - Call it inside the same `tm.run` as the occurrence-row write, under the lock of the recurrence or occurrence row,
 *   deciding only on the row read under that lock, and only for a date not decided yet.
 * - Pass the P21 user: the recurrence's creator for an AUTO occurrence, the authorized requester for a confirmation.
 * - Abort on a refusal. The nested use case joins the caller's transaction and rolls nothing back by itself (see
 *   `DrizzleTransactionManager.run`), so the caller must return the refusal (or throw) from its own `tm.run`.
 */
export const recordOccurrence = async (
  recorders: OccurrenceRecorders,
  recurrence: Recurrence,
  occurrence: { readonly userId: string; readonly date: LocalDate; readonly amount: Money },
): Promise<Result<RecordedOccurrence>> => {
  const base = {
    spaceId: recurrence.spaceId,
    userId: occurrence.userId,
    description: recurrence.description,
    date: occurrence.date,
    // HU-E4-14, ruling P66: an occurrence, AUTO or confirmed, carries its date and no time.
    untimed: true as const,
    amount: occurrence.amount,
  };
  const alone = (transaction: Transaction): RecordedOccurrence => ({ transaction, warnings: [] });
  const template = recurrence.template;
  switch (template.type) {
    case "EXPENSE":
      return map(
        await recorders.expense({
          ...base,
          categoryId: template.categoryId,
          payments: [
            {
              memberId: template.payer.memberId,
              accountId: template.payer.accountId,
              amount: occurrence.amount,
            },
          ],
          split: template.split ?? undefined,
        }),
        (recorded): RecordedOccurrence => ({ transaction: recorded.expense, warnings: recorded.warnings }),
      );
    case "INCOME":
      return map(
        await recorders.income({ ...base, categoryId: template.categoryId, accountId: template.accountId }),
        alone,
      );
    case "TRANSFER":
      return map(
        await recorders.transfer({
          ...base,
          sourceAccountId: template.sourceAccountId,
          destinationAccountId: template.destinationAccountId,
        }),
        alone,
      );
    case "FUND_CONTRIBUTION":
      return map(
        await recorders.fundContribution({
          ...base,
          fundAccountId: template.fundAccountId,
          memberId: template.memberId,
          sourceAccountId: template.sourceAccountId,
        }),
        alone,
      );
  }
};
