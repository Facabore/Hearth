import type { SpaceMembership } from "@/modules/spaces/application";
import { defaultSplitMembers, domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import { splitShares, type AllocationSplit, type SplitInput } from "../domain/split";
import {
  payForFund,
  positiveAmount,
  recordExpense,
  recordFundContribution,
  withLegs,
  type AccountLeg,
  type Expense,
  type Payment,
  type Transfer,
} from "../domain/transaction";
import { authorizeWriter, fundAccount, openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { recordedLegOf } from "./foreign-amount";
import { resolvePayments, type PaymentInput } from "./payments";
import { contributionParties } from "./record-fund-contribution";
import type { DefaultSplitQuery } from "./ports";
import { whenOf, type WhenInput } from "./when";

export type { PaymentInput } from "./payments";

/** Spec 5.2, P342: one requested payment, in the expense's currency, and what its account moved in its own currency. */
export interface ExpensePaymentInput extends PaymentInput {
  /**
   * P342 (S3): what the paying account really moved, in the account's currency, when that is not the expense's; when
   * absent, the payment at the date's rate. Only for a payment from an account.
   */
  readonly accountAmount?: Money;
}

export interface RecordExpenseInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly categoryId?: string;
  /** P342 (S3): what was charged, in its own currency, which the expense, its payments and its shares keep. */
  readonly amount: Money;
  /**
   * P342 (S3): what the sole paying account really moved, in the account's currency, when that is not `amount`'s ("Tu
   * Visa Oro en pesos pagó 205.000 COP"); when absent, `amount` at the date's rate. It goes with `accountId`, a sole
   * entry of `payments` that has none of its own, or, with `paidForFund`, the contributor's account.
   */
  readonly accountAmount?: Money;
  /** HU-E4-01 shorthand: the requester pays the whole amount from this account of theirs. Ignored with `payments`. */
  readonly accountId?: string;
  /** HU-E4-07: who paid, registered members, guests or the shared fund; the v1 UI offers one payer. */
  readonly payments?: readonly ExpensePaymentInput[];
  /** HU-E4-07/08: how the amount is shared; when absent, the default split (spec 5.3, HU-E6-08). */
  readonly split?: SplitInput;
  /**
   * D26: a member pays the expense for the fund: their contribution to it from their own account (as RecordFundContribution
   * takes it) and the fund's payment of the expense, linked. Not with `accountId` or `payments`: the fund pays.
   */
  readonly paidForFund?: {
    readonly fundAccountId: string;
    /** The contributing member, registered or guest; the requester when absent. */
    readonly memberId?: string;
    /** The contributor's own account; null or absent only for a guest. */
    readonly sourceAccountId?: string | null;
  };
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
 * covering the date, else EQUAL among every current member but the VIEWERs (P293). The member can always choose
 * another split.
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

/**
 * P342 (S3): each requested payment's account amount, in order: its own, or for a sole payment the expense's
 * `accountAmount` (never the fund's payment when paying for it: that one is the contributor's); with several payments
 * the expense's one names none of them (InvalidTransferLeg).
 */
const paymentAccountAmounts = (
  input: RecordExpenseInput,
  requested: readonly ExpensePaymentInput[],
): Result<(Money | undefined)[]> => {
  const own = requested.map((payment) => payment.accountAmount);
  if (input.accountAmount === undefined || input.paidForFund !== undefined) return ok(own);
  if (requested.length !== 1) return err(domainError("InvalidTransferLeg"));
  return ok([own[0] ?? input.accountAmount]);
};

/** HU-E4-10: the fund may go negative; the expense is recorded and the response warns. */
export const fundWarnings = async (
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
 * current member of their personal space, takes the whole EQUAL share. D26: `paidForFund` records the expense as a
 * linked contribution to the fund and the fund's payment of it, under the same space lock.
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
      const category = await usableCategory(deps, space.spaceId, input.categoryId);
      if (!category.ok) return category;
      const members = await deps.members.listCurrent(space.spaceId);
      const memberIds = members.map((m) => m.id);
      const forFund = input.paidForFund;
      if (forFund !== undefined && (input.accountId !== undefined || input.payments !== undefined)) {
        return err(domainError("InvalidPaidForFund", { reason: "payerGiven" }));
      }
      // P342 (S3): the expense, its payments and its shares are in the currency it was charged in. Paying for the fund
      // is the fund's own payment, so it takes only an expense in the fund's currency (no exchange inside the pair).
      const currency = input.amount.currency.code;
      if (forFund !== undefined) {
        const fund = await fundAccount(deps, forFund.fundAccountId, space.spaceId);
        if (fund.ok && fund.value.currency !== currency) {
          return err(domainError("MultiCurrencyUnsupported", { reason: "paidForFund" }));
        }
      }
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      // D26: for the fund, the fund pays the expense with what the member contributes to it.
      const requested: readonly ExpensePaymentInput[] =
        forFund === undefined
          ? (input.payments ?? [
              { memberId: space.memberId, accountId: input.accountId ?? null, amount: input.amount },
            ])
          : [{ memberId: null, accountId: forFund.fundAccountId, amount: input.amount }];
      // P342: every payment is in the expense's currency (CurrencyMismatch), which resolvePayments checks as `currency`.
      const resolved = await resolvePayments(deps, { ...space, currency }, members, requested, input.userId);
      if (!resolved.ok) return resolved;
      const accountAmounts = paymentAccountAmounts(input, requested);
      if (!accountAmounts.ok) return accountAmounts;
      const contributor =
        forFund === undefined
          ? ok(null)
          : await contributionParties(deps, space, members, { ...forFund, userId: input.userId });
      if (!contributor.ok) return contributor;
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
          ...defaultSplitMembers(members),
        }));
      const shares = splitShares(input.amount, split, memberIds);
      if (!shares.ok) return shares;
      const expense = recordExpense({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: input.amount.minor,
        currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        categoryId: category.value,
        payments: resolved.value,
        shares: shares.value,
      });
      if (!expense.ok) return expense;
      // P342 (S3): each paying account in another currency keeps what it moved; the rate lookup is a read inside the
      // already-held space lock (#89).
      const legs: (AccountLeg | null)[] = [];
      for (const [index, payment] of requested.entries()) {
        const leg = await recordedLegOf(
          deps,
          resolved.value[index]!.accountId,
          payment.amount,
          accountAmounts.value[index],
          date,
        );
        if (!leg.ok) return leg;
        legs.push(leg.value);
      }
      const legged = withLegs(expense.value, { payments: legs }) as Result<Expense>;
      if (!legged.ok) return legged;
      if (contributor.value === null) {
        await deps.transactions.add(legged.value);
        return ok({
          expense: legged.value,
          warnings: await fundWarnings(deps, space, input.userId, legged.value.payments),
        });
      }
      const contribution = recordFundContribution({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        payerMemberId: contributor.value.contributorMemberId,
        sourceAccountId: contributor.value.sourceAccountId,
        destinationAccountId: contributor.value.fundAccountId,
      });
      if (!contribution.ok) return contribution;
      // P342: the contributor's account keeps what it moved when it is not in the fund's (the expense's) currency.
      const source = await recordedLegOf(
        deps,
        contributor.value.sourceAccountId,
        input.amount,
        input.accountAmount,
        date,
      );
      if (!source.ok) return source;
      const contributed = withLegs(contribution.value, {
        source: source.value,
        destination: null,
      }) as Result<Transfer>;
      if (!contributed.ok) return contributed;
      const pair = payForFund(contributed.value, legged.value);
      if (!pair.ok) return pair;
      // D26: both halves in one statement, so neither is ever stored alone (like P322's gift).
      await deps.transactions.add(...pair.value);
      const [, paid] = pair.value;
      return ok({ expense: paid, warnings: await fundWarnings(deps, space, input.userId, paid.payments) });
    });
