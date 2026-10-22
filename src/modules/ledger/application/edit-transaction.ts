import { domainError, err, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import {
  canModify,
  changedDebits,
  changesBetween,
  reviseTransaction,
  type Transaction,
} from "../domain/transaction";
import { ensureCurrentParties, openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { editedTime } from "./when";

export interface EditChanges {
  readonly description?: string;
  readonly date?: LocalDate;
  /** HU-E4-14: a new instant; null answers TimeRequired, since a time is replaced, never removed (P66). */
  readonly occurredAt?: Date | null;
  readonly timeZone?: string;
  readonly categoryId?: string;
  readonly amount?: Money;
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

/**
 * D9: a new amount debits its personal accounts again, so only their owner may change it, even when
 * money.editAny lets OWNER or ADMIN edit the rest. Any writer may spend the shared fund.
 */
const ownedDebits = async (
  deps: Pick<LedgerDeps, "accounts">,
  accountIds: readonly string[],
  userId: string,
): Promise<Result<void>> => {
  for (const accountId of accountIds) {
    const account = await deps.accounts.find(accountId);
    if (account?.isSharedFund === true) continue;
    if (account?.ownerUserId !== userId) return err(domainError("AccountNotOwned"));
  }
  return ok(undefined);
};

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
      if (!canModify(membership.value.role, current.createdBy, input.userId)) {
        return err(domainError("InsufficientRole"));
      }
      if (input.expectedVersion !== null && input.expectedVersion !== current.version) {
        return err(domainError("PreconditionFailed"));
      }
      const { amount, date, occurredAt, timeZone, ...rest } = input.changes;
      if (amount && amount.currency.code !== current.currency) {
        return err(
          domainError("CurrencyMismatch", { expected: current.currency, actual: amount.currency.code }),
        );
      }
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      const now = deps.clock.now();
      // HU-E4-14: a new date keeps the wall-clock time; a new time recomputes the date (ruling P42).
      const time = await editedTime(deps, current, input.userId, { date, occurredAt, timeZone });
      if (!time.ok) return time;
      // Only the three time fields, so no other field of the answer can override `rest`.
      const { date: newDate, occurredAt: newOccurredAt, timeZone: newTimeZone } = time.value;
      const revised = reviseTransaction(
        current,
        { ...rest, date: newDate, occurredAt: newOccurredAt, timeZone: newTimeZone, amount: amount?.minor },
        now,
      );
      if (!revised.ok) return revised;
      const changes = changesBetween(current, revised.value);
      if (Object.keys(changes).length === 0) return ok(current);
      const debits = await ownedDebits(deps, changedDebits(current, revised.value), input.userId);
      if (!debits.ok) return debits;
      // HU-E1-08, HU-E1-12: a new amount must not move the balance of a member who left (Task 4b).
      if (changes.amount) {
        const parties = await ensureCurrentParties(deps, membership.value.spaceId, current);
        if (!parties.ok) return parties;
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
