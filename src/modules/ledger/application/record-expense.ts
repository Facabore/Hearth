import type { SpaceMembership } from "@/modules/spaces/application";
import { ok, type Money, type Result } from "@/shared/kernel";
import { splitShares, type AllocationSplit, type SplitInput } from "../domain/split";
import { positiveAmount, recordExpense, type Expense, type Payment } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency, openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { resolvePayments, type PaymentInput } from "./payments";
import type { DefaultSplitQuery } from "./ports";
import { whenOf, type WhenInput } from "./when";

export type { PaymentInput } from "./payments";

export interface RecordExpenseInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly categoryId?: string;
  readonly amount: Money;
  /** HU-E4-01 shorthand: the requester pays the whole amount from this account of theirs. Ignored with `payments`. */
  readonly accountId?: string;
  /** HU-E4-07: who paid, registered members, guests or the shared fund; the v1 UI offers one payer. */
  readonly payments?: readonly PaymentInput[];
  /** HU-E4-07/08: how the amount is shared; when absent, the default split (spec 5.3, HU-E6-08). */
  readonly split?: SplitInput;
}

/** A non-blocking condition of a recorded expense, reported as a code (HU-E4-10). */
export interface LedgerWarning {
  readonly code: "FundBalanceNegative";
  readonly accountId: string;
  /** The account balance after the expense, in minor units. */
  readonly balance: bigint;
}

export interface RecordedExpense {
  readonly expense: Expense;
  readonly warnings: readonly LedgerWarning[];
}

export type RecordExpense = (input: RecordExpenseInput) => Promise<Result<RecordedExpense>>;

/**
 * Spec 5.3, HU-E6-08: without a chosen split, BY_ALLOCATION by the line the category consumes in the ACTIVE plan
 * covering the date, else EQUAL among every current member. The member can always choose another split.
 */
const defaultSplit = async (
  deps: Pick<LedgerDeps, "defaultSplits">,
  expense: DefaultSplitQuery,
): Promise<SplitInput | AllocationSplit> => {
  const weights = await deps.defaultSplits.allocationWeights(expense);
  return weights === null
    ? { method: "EQUAL", participants: expense.memberIds.map((memberId) => ({ memberId })) }
    : { method: "BY_ALLOCATION", participants: weights };
};

/** HU-E4-10: the fund may go negative; the expense is recorded and the response warns. */
const fundWarnings = async (
  deps: Pick<LedgerDeps, "accountBalances">,
  space: SpaceMembership,
  userId: string,
  payments: readonly Payment[],
): Promise<LedgerWarning[]> => {
  const warnings: LedgerWarning[] = [];
  for (const payment of payments) {
    if (payment.memberId !== null || payment.accountId === null) continue;
    const balance = await deps.accountBalances.balanceOf(space.spaceId, userId, payment.accountId);
    if (balance < 0n) warnings.push({ code: "FundBalanceNegative", accountId: payment.accountId, balance });
  }
  return warnings;
};

/**
 * HU-E4-01, HU-E4-07, HU-E4-10: one use case for personal and shared expenses (D2). A personal expense
 * is a shared expense with one participant: the requester pays from `accountId` and, being the only
 * current member of their personal space, takes the whole EQUAL share.
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
      const members = await deps.members.listCurrent(space.spaceId);
      const memberIds = members.map((m) => m.id);
      const requested: readonly PaymentInput[] = input.payments ?? [
        { memberId: space.memberId, accountId: input.accountId ?? null, amount: input.amount },
      ];
      const payments = await resolvePayments(deps, space, members, requested, input.userId);
      if (!payments.ok) return payments;
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      // HU-E4-06 first (P14): a closed period takes nothing, and the guard's FOR SHARE lock on the covering plan keeps
      // plan writes out while the default split reads it.
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const split =
        input.split ??
        (await defaultSplit(deps, {
          spaceId: space.spaceId,
          currency: space.currency,
          categoryId: category.value,
          date,
          memberIds,
        }));
      const shares = splitShares(input.amount, split, memberIds);
      if (!shares.ok) return shares;
      const expense = recordExpense({
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
        payments: payments.value,
        shares: shares.value,
      });
      if (!expense.ok) return expense;
      await deps.transactions.add(expense.value);
      return ok({
        expense: expense.value,
        warnings: await fundWarnings(deps, space, input.userId, expense.value.payments),
      });
    });
