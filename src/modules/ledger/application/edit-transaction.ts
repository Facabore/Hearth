import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type DomainError, type Err, type Result } from "@/shared/kernel";
import {
  canModify,
  changedDebits,
  changesBetween,
  linkedHalfOf,
  reviseTransaction,
  type Transaction,
  type TransactionChanges,
} from "../domain/transaction";
import { ensureCurrentParties, openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";
import { editedAmountOf, type EditedAmount } from "./edited-amount";
import { editedParts, type EditChanges, type PartChanges } from "./edited-parts";
import { knownAmountsOf, withAccountLegs } from "./foreign-amount";
import { editedTime } from "./when";

export type { EditChanges } from "./edited-parts";

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

/**
 * HU-E4-06, D29: the revised transaction with every account leg recomputed by the rules of recording whenever its amount
 * or an account changes, from what the edit gives in an account's currency, else from what the row was entered in. An
 * edit of nothing else keeps them as they are. A foreign amount stays on one payment from one account (section 4.3).
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
  const tx = revised.value;
  const moved =
    priced !== null ||
    parts.payments !== undefined ||
    parts.sourceAccountId !== undefined ||
    parts.destinationAccountId !== undefined;
  if (!moved) return revised;
  if (tx.type === "EXPENSE" && tx.originalAmount !== undefined) {
    const [only, ...others] = tx.payments;
    if (others.length > 0 || only?.memberId === null) {
      return err(
        domainError("MultiCurrencyUnsupported", { reason: others.length > 0 ? "multiPayer" : "paidForFund" }),
      );
    }
  }
  return withAccountLegs(deps, space, tx, priced?.known ?? knownAmountsOf(current));
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
      // Ruling P186: the part fields (accounts, payers) are resolved by `editedParts` below.
      const { description, categoryId, date, occurredAt, timeZone } = input.changes;
      // Ruling P322, D26: either half of a gift or of an expense paid for the fund keeps the amount and the date of the
      // other, and the fund stays the payer of the expense; delete and record again.
      if (linkedHalfOf(current) !== null) {
        const moved = (["amount", "date", "occurredAt", "timeZone", "accountId", "payments"] as const).find(
          (field) => input.changes[field] !== undefined,
        );
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
      // D29: a new amount is read as recording reads it, at the edited date's rate (a read inside the held lock, #89).
      const priced = await editedAmountOf(deps, membership.value, current, input.changes, newDate);
      if (!priced.ok) return refused(priced);
      const base = priced.value?.base;
      const parts = await editedParts(
        deps,
        membership.value,
        current,
        { ...input.changes, amount: base },
        input.userId,
      );
      if (!parts.ok) return refused(parts);
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
          amount: base?.minor,
          ...(priced.value === null ? {} : { original: priced.value.original }),
        },
        now,
      );
      if (!revised.ok) return refused(revised);
      const changes = changesBetween(current, revised.value);
      if (Object.keys(changes).length === 0) return ok(current);
      if (!open.ok) return open;
      const debits = await ownedDebits(deps, changedDebits(current, revised.value), input.userId);
      if (!debits.ok) return debits;
      // HU-E1-08, HU-E1-12: a new amount, payer or split must not move the balance of a member who left. Both
      // versions count: a fund-paid expense has no parties, but a member-paid revision of it would move its shares'.
      if (changes.amount || changes.payments || changes.shares) {
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
