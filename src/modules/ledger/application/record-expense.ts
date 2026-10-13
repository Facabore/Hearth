import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, todayIn, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { splitShares, type SplitInput } from "../domain/split";
import { positiveAmount, recordExpense, type Expense, type Payment } from "../domain/transaction";
import { authorizeWriter, inSpaceCurrency, openPeriod, partyAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

/** One requested payment (spec 5.2). */
export interface PaymentInput {
  /** The paying member, registered or guest. */
  readonly memberId: string;
  /** The payer's own account; null for a guest, who pays outside the app. */
  readonly accountId: string | null;
  readonly amount: Money;
}

export interface RecordExpenseInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly date?: LocalDate;
  readonly categoryId?: string;
  readonly amount: Money;
  /** HU-E4-01 shorthand: the requester pays the whole amount from this account of theirs. Ignored with `payments`. */
  readonly accountId?: string;
  /** HU-E4-07: who paid, registered members or guests; the domain accepts several (the v1 UI offers one). */
  readonly payments?: readonly PaymentInput[];
  /** HU-E4-07/08: how the amount is shared; EQUAL among every current member when absent (spec 5.3). */
  readonly split?: SplitInput;
}

export type RecordExpense = (input: RecordExpenseInput) => Promise<Result<Expense>>;

/**
 * A current member pays: registered members from an account their user owns (and only the requester
 * may debit their own account, D9), guests outside the app.
 */
const paymentOf = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: PaymentInput,
): Promise<Result<Payment>> => {
  const currency = inSpaceCurrency(space, requested.amount);
  if (!currency.ok) return currency;
  const { memberId, accountId } = requested;
  const amount = requested.amount.minor;
  const debit = { required: true, debitedBy: space.userId };
  return map(await partyAccount(deps, members, memberId, accountId, debit), (account) => ({
    memberId,
    accountId: account,
    amount,
  }));
};

/**
 * HU-E4-01, HU-E4-07: one use case for personal and shared expenses (D2). A personal expense is a
 * shared expense with one participant: the requester pays from `accountId` and, being the only current
 * member of their personal space, takes the whole EQUAL share.
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
      const requested: readonly PaymentInput[] = input.payments ?? [
        { memberId: space.memberId, accountId: input.accountId ?? null, amount: input.amount },
      ];
      // Each member pays at most once per expense, like each participant takes one share.
      const payers = requested.map((payment) => payment.memberId);
      if (new Set(payers).size !== payers.length) {
        return err(domainError("InvalidSplit", { reason: "duplicatePayer" }));
      }
      const payments: Payment[] = [];
      for (const payment of requested) {
        const resolved = await paymentOf(deps, space, members, payment);
        if (!resolved.ok) return resolved;
        payments.push(resolved.value);
      }
      const split: SplitInput = input.split ?? {
        method: "EQUAL",
        participants: members.map((m) => ({ memberId: m.id })),
      };
      const shares = splitShares(
        input.amount,
        split,
        members.map((m) => m.id),
      );
      if (!shares.ok) return shares;
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
        payments,
        shares: shares.value,
      });
      if (!expense.ok) return expense;
      await deps.transactions.add(expense.value);
      return expense;
    });
