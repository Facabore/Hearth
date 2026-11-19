import type { SpaceMembership } from "@/modules/spaces/application";
import {
  domainError,
  err,
  Money,
  ok,
  type DomainError,
  type Err,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import {
  canCorrect,
  changesBetween,
  linkedHalfOf,
  reviseTransaction,
  withLegs,
  type AccountLeg,
  type ChangeSet,
  type Expense,
  type Income,
  type Transaction,
  type TransactionChanges,
} from "../domain/transaction";
import { ensureCurrentParties, openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { editedAmountOf, type EditedAmount } from "./edited-amount";
import { editedParts, type EditChanges as PartEditChanges, type PartChanges } from "./edited-parts";
import { accountLegOf, knownAmountsOf, recordedLegOf, withAccountLegs } from "./foreign-amount";
import { editedTime } from "./when";

/** HU-E4-06, ruling P186: what an edit changes; P342 (S3) adds what the paying or receiving account moved. */
export interface EditChanges extends PartEditChanges {
  /**
   * P342 (S3): what the account really moved, in its own currency, when that is not the movement's: an expense's sole
   * payment or an income's account ("Tu Visa Oro en pesos pagó 205.000 COP"); when absent, the date's rate decides.
   */
  readonly accountAmount?: Money;
}

export interface EditTransactionInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly transactionId: string;
  /** The If-Match version; null skips the check. */
  readonly expectedVersion: number | null;
  readonly changes: EditChanges;
}

export type EditTransaction = (input: EditTransactionInput) => Promise<Result<Transaction>>;

/** A sole payment's or an income's leg as stored, as money in the account's currency; none when there is no leg. */
const storedLeg = (amount: bigint | undefined, currency: string | undefined): Money[] => {
  if (amount === undefined || currency === undefined) return [];
  const leg = Money.ofMinor(amount, currency);
  return leg.ok ? [leg.value] : [];
};

/**
 * P342 (S3): the leg of an account an expense's payment or an income comes from or goes to, by the rules of recording:
 * what the edit typed for it (`recordedLegOf`: in the account's currency, and only for an account in another currency
 * than the movement's), else what the movement already moved it by (`kept`, when the amount stays), else the amount at
 * the date's rate (ExchangeRateRequired without one); none for an account in the movement's own currency.
 */
const recordedLeg = (
  deps: LedgerDeps,
  space: SpaceMembership,
  accountId: string | null,
  amount: Money,
  typed: Money | undefined,
  kept: readonly Money[],
  date: LocalDate,
): Promise<Result<AccountLeg | null>> =>
  typed === undefined
    ? accountLegOf(deps, space, accountId, amount, kept, date)
    : recordedLegOf(deps, accountId, amount, typed, date);

/**
 * P342 (S3): every account leg of an edited expense or income. A typed `accountAmount` names a sole payment
 * (InvalidTransferLeg with several, as when recording); when the edit sends no amount, a sole payment's or the income's
 * account keeps what it moved if it is still in that currency.
 */
const recordedLegs = async (
  deps: LedgerDeps,
  space: SpaceMembership,
  current: Transaction,
  tx: Expense | Income,
  priced: EditedAmount | null,
): Promise<Result<Transaction>> => {
  const typed = priced?.accountAmount;
  const kept =
    priced !== null
      ? []
      : [
          ...knownAmountsOf(current),
          ...(current.type === "EXPENSE" && current.payments.length === 1
            ? storedLeg(current.payments[0]!.accountAmount, current.payments[0]!.accountCurrency)
            : []),
          ...(current.type === "INCOME"
            ? storedLeg(current.destinationAmount, current.destinationCurrency)
            : []),
        ];
  const moneyOf = (minor: bigint) => Money.ofMinor(minor, tx.currency);
  if (tx.type === "INCOME") {
    const amount = moneyOf(tx.amount);
    if (!amount.ok) return amount;
    const destination = await recordedLeg(
      deps,
      space,
      tx.destinationAccountId,
      amount.value,
      typed,
      kept,
      tx.date,
    );
    if (!destination.ok) return destination;
    return withLegs(tx, { source: null, destination: destination.value });
  }
  if (typed !== undefined && tx.payments.length !== 1) return err(domainError("InvalidTransferLeg"));
  const sole = tx.payments.length === 1;
  const payments: (AccountLeg | null)[] = [];
  for (const payment of tx.payments) {
    const paid = moneyOf(payment.amount);
    if (!paid.ok) return paid;
    const leg = await recordedLeg(
      deps,
      space,
      payment.accountId,
      paid.value,
      typed,
      sole ? kept : [],
      tx.date,
    );
    if (!leg.ok) return leg;
    payments.push(leg.value);
  }
  return withLegs(tx, { payments });
};

/**
 * P342 (S3): an expense moves to another currency only when its parts follow: its payments (a sole one, or new ones)
 * and its shares (a sole one, or new ones); otherwise they would keep figures of the old currency
 * (SharesDoNotMatchAmount). An income has no parts; the other types never change currency.
 */
const partsFollow = (current: Transaction, parts: PartChanges): Result<void> => {
  if (current.type !== "EXPENSE") return ok(undefined);
  const payments = parts.payments !== undefined || current.payments.length === 1;
  const shares = parts.shares !== undefined || current.shares.length === 1;
  return payments && shares ? ok(undefined) : err(domainError("SharesDoNotMatchAmount"));
};

/**
 * HU-E4-06, D29, P342: the revised transaction, in `currency`, with every account leg recomputed by the rules of
 * recording whenever its amount, its currency or an account changes, from what the edit gives in an account's
 * currency, else from what the row already moved. An edit of nothing else keeps them as they are.
 */
const revisedWithLegs = async (
  deps: LedgerDeps,
  space: SpaceMembership,
  current: Transaction,
  priced: EditedAmount | null,
  parts: PartChanges,
  changes: TransactionChanges,
  now: Date,
): Promise<Result<Transaction>> => {
  const revised = reviseTransaction(current, changes, now);
  if (!revised.ok) return revised;
  const currency = priced?.amount.currency.code ?? current.currency;
  if (currency !== current.currency) {
    const follow = partsFollow(current, parts);
    if (!follow.ok) return follow;
  }
  const tx = { ...revised.value, currency } as Transaction;
  const moved =
    priced !== null ||
    parts.payments !== undefined ||
    parts.sourceAccountId !== undefined ||
    parts.destinationAccountId !== undefined;
  if (!moved) return ok(tx);
  if (tx.type === "EXPENSE" || tx.type === "INCOME") return recordedLegs(deps, space, current, tx, priced);
  // P344 (S4): with the amount unchanged, a settlement's side that keeps its account keeps what it moved, also an
  // explicit exchange (P342 S5); a newly named account in another currency moves by the date's rate, as recording
  // suggests (`settlementLegOf` without a typed leg).
  const kept =
    current.type === "SETTLEMENT"
      ? [
          ...storedLeg(current.sourceAmount, current.sourceCurrency),
          ...storedLeg(current.destinationAmount, current.destinationCurrency),
        ]
      : [];
  return withAccountLegs(deps, space, tx, priced?.known ?? [...knownAmountsOf(current), ...kept]);
};

/**
 * D8, P342: what the edit changed beyond the domain's audited fields: the movement's currency, which an amount of the
 * same figure in another currency would otherwise leave out of the audit (and out of the edit).
 */
const auditedChanges = (current: Transaction, revised: Transaction): ChangeSet => ({
  ...changesBetween(current, revised),
  ...(current.currency === revised.currency
    ? {}
    : { currency: { from: current.currency, to: revised.currency } }),
});

export const createEditTransaction =
  (deps: LedgerDeps): EditTransaction =>
  (input) =>
    deps.tm.run(async () => {
      // Issue #89: the space row first (see authorizeWriter), before anything the write decides on is read.
      await deps.spaceLocks.lockForMoneyWrite(input.spaceId);
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const current = await deps.transactions.findById(membership.value.spaceId, input.transactionId);
      if (!current) return err(domainError("TransactionNotFound"));
      if (!canCorrect(membership.value.role)) {
        return err(domainError("InsufficientRole"));
      }
      if (input.expectedVersion !== null && input.expectedVersion !== current.version) {
        return err(domainError("PreconditionFailed"));
      }
      // Ruling P186: the part fields (accounts, payers) are resolved by `editedParts` below.
      const { description, categoryId, date, occurredAt, timeZone } = input.changes;
      // Ruling P322, D26: either half of a gift or of an expense paid for the fund keeps the amount and the date of the
      // other, and the fund stays the payer of the expense; delete and record again.
      // P344: so does who paid and received, and from or into which account (as P188 had it before).
      if (linkedHalfOf(current) !== null) {
        const moved = (
          [
            "amount",
            "date",
            "occurredAt",
            "timeZone",
            "accountId",
            "payments",
            "payerMemberId",
            "receivingMemberId",
            "sourceAccountId",
            "destinationAccountId",
          ] as const
        ).find((field) => input.changes[field] !== undefined);
        if (moved) return err(domainError("FieldNotEditable", { field: moved }));
      }
      // Issue #246: a closed period refuses a real change, and an edit that changes nothing answers the movement as it
      // is, as in an open period. The check keeps its place, so a failing change still answers PeriodClosed first.
      const open = await openPeriod(deps, current.spaceId, current.date);
      const refused = (failure: Err<DomainError>) => (open.ok ? failure : open);
      const now = deps.clock.now();
      // HU-E4-14: a new date keeps the wall-clock time; a new time recomputes the date (ruling P42).
      const time = await editedTime(deps, current, input.userId, { date, occurredAt, timeZone });
      if (!time.ok) return refused(time);
      // Only the three time fields, so no other field of the answer can override the fields passed below.
      const { date: newDate, occurredAt: newOccurredAt, timeZone: newTimeZone } = time.value;
      // D29, P342: a new amount is read as recording reads it, in its own currency, at the edited date's rate for an
      // account in another one (a read inside the held lock, #89).
      const priced = await editedAmountOf(deps, current, input.changes, newDate);
      if (!priced.ok) return refused(priced);
      const amount = priced.value?.amount;
      // P342: payments and shares are in the movement's currency, the new amount's when it brings another.
      const currency = amount?.currency.code ?? current.currency;
      const parts = await editedParts(
        deps,
        { ...membership.value, currency },
        current,
        { ...input.changes, amount },
        input.userId,
      );
      if (!parts.ok) return refused(parts);
      // P342: a new amount of an expense or income replaces what an earlier version converted, with no original kept.
      const entered = current.type === "EXPENSE" || current.type === "INCOME";
      const revised = await revisedWithLegs(
        deps,
        membership.value,
        current,
        priced.value,
        parts.value,
        {
          description,
          categoryId,
          ...parts.value,
          date: newDate,
          occurredAt: newOccurredAt,
          timeZone: newTimeZone,
          amount: amount?.minor,
          ...(entered && input.changes.amount !== undefined ? { original: null } : {}),
        },
        now,
      );
      if (!revised.ok) return refused(revised);
      const changes = auditedChanges(current, revised.value);
      if (Object.keys(changes).length === 0) return ok(current);
      if (!open.ok) return open;
      // P344 (S3): a changed debit on another member's account is a correction like any other, kept in the audit below;
      // only a newly named account must be the editor's own (`editedParts`).
      // HU-E1-08, HU-E1-12: a new amount, payer or split must not move the balance of a member who left. Both
      // versions count: a fund-paid expense has no parties, but a member-paid revision of it would move its shares'.
      // P344 (S4): nor a settlement's new payer or receiver.
      const partiesMove =
        changes.payments || changes.shares || changes.payerMemberId || changes.receivingMemberId;
      if (changes.amount || changes.currency || partiesMove) {
        for (const version of [current, revised.value]) {
          const parties = await ensureCurrentParties(deps, membership.value.spaceId, version);
          if (!parties.ok) return parties;
        }
      }
      if (changes.date) {
        // HU-E4-06: moving a transaction into a closed period is rejected too.
        const target = await openPeriod(deps, current.spaceId, revised.value.date);
        if (!target.ok) return target;
      }
      if (changes.categoryId) {
        const category = await usableCategory(deps, current.spaceId, revised.value.categoryId);
        if (!category.ok) return category;
      }
      // The repository compares versions again, so a concurrent edit between read and write still loses.
      if (!(await deps.transactions.save(revised.value, current.version))) {
        return err(domainError("PreconditionFailed"));
      }
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: current.id,
        action: "UPDATED",
        actorUserId: input.userId,
        at: now,
        changes,
      });
      return ok({ ...revised.value, version: current.version + 1 });
    });
