import type { SpaceMembership } from "@/modules/spaces/application";
import { defaultSplitMembers, domainError, err, ok, type Money, type Result } from "@/shared/kernel";
import { splitShares, type AllocationSplit, type SplitInput } from "../domain/split";
import {
  payForFund,
  positiveAmount,
  recordExpense,
  recordFundContribution,
  type Expense,
  type Payment,
} from "../domain/transaction";
import { authorizeWriter, openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { baseAmountOf, withAccountLegs } from "./foreign-amount";
import { resolvePayments, type PaymentInput } from "./payments";
import { contributionParties } from "./record-fund-contribution";
import type { DefaultSplitQuery } from "./ports";
import { whenOf, type WhenInput } from "./when";

export type { PaymentInput } from "./payments";

export interface RecordExpenseInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly categoryId?: string;
  readonly amount: Money;
  /**
   * D29, slice MC3: the real amount in the space's base currency the bank charged, when `amount` is in another
   * currency; it wins over the rate. Ignored when `amount` is already in the base currency.
   */
  readonly convertedAmount?: Money;
  /** HU-E4-01 shorthand: the requester pays the whole amount from this account of theirs. Ignored with `payments`. */
  readonly accountId?: string;
  /** HU-E4-07: who paid, registered members, guests or the shared fund; the v1 UI offers one payer. */
  readonly payments?: readonly PaymentInput[];
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
      // D29, slice MC3, section 4.3: this slice converts one paying account only. A foreign amount split across several
      // payers, or paid for the fund, is not yet supported (shares, Saldos and the plan stay in the base currency).
      const foreign = input.amount.currency.code !== space.currency;
      if (foreign && (forFund !== undefined || (input.payments !== undefined && input.payments.length > 1))) {
        return err(
          domainError("MultiCurrencyUnsupported", {
            reason: forFund !== undefined ? "paidForFund" : "multiPayer",
          }),
        );
      }
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      // D29 section 4.2: the stored base amount (space currency) and, for a foreign amount, the original kept with it;
      // the rate lookup is a read inside the already-held space lock (#89).
      const base = await baseAmountOf(deps, space, input.amount, input.convertedAmount, date);
      if (!base.ok) return base;
      // D26: for the fund, the fund pays the expense with what the member contributes to it. The payment amount is the
      // base (space currency); a foreign amount becomes a single base payment, its account leg attached below.
      const requested: readonly PaymentInput[] = foreign
        ? [
            {
              memberId: input.payments?.[0]?.memberId ?? space.memberId,
              accountId: input.payments?.[0]?.accountId ?? input.accountId ?? null,
              amount: base.value.base,
            },
          ]
        : forFund === undefined
          ? (input.payments ?? [
              { memberId: space.memberId, accountId: input.accountId ?? null, amount: input.amount },
            ])
          : [{ memberId: null, accountId: forFund.fundAccountId, amount: input.amount }];
      const resolved = await resolvePayments(deps, space, members, requested, input.userId);
      if (!resolved.ok) return resolved;
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
      const shares = splitShares(base.value.base, split, memberIds);
      if (!shares.ok) return shares;
      const expense = recordExpense({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: base.value.base.minor,
        currency: space.currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        categoryId: category.value,
        payments: resolved.value,
        shares: shares.value,
        ...(base.value.original === undefined
          ? {}
          : { originalAmount: base.value.original.amount, originalCurrency: base.value.original.currency }),
      });
      if (!expense.ok) return expense;
      // D29, section 4.1: each paying account's leg in its own currency whenever it is not the base.
      const legged = await withAccountLegs(deps, space, expense.value, [input.amount]);
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
        currency: space.currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        payerMemberId: contributor.value.contributorMemberId,
        sourceAccountId: contributor.value.sourceAccountId,
        destinationAccountId: contributor.value.fundAccountId,
      });
      if (!contribution.ok) return contribution;
      const contributed = await withAccountLegs(deps, space, contribution.value, []);
      if (!contributed.ok) return contributed;
      const pair = payForFund(contributed.value, legged.value);
      if (!pair.ok) return pair;
      // D26: both halves in one statement, so neither is ever stored alone (like P322's gift).
      await deps.transactions.add(...pair.value);
      const [, paid] = pair.value;
      return ok({ expense: paid, warnings: await fundWarnings(deps, space, input.userId, paid.payments) });
    });
