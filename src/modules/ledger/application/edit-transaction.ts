import { domainError, err, ok, type LocalDate, type Money, type Result } from "@/shared/kernel";
import { canModify, changesBetween, reviseTransaction, type Transaction } from "../domain/transaction";
import { openPeriod, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

export interface EditChanges {
  readonly description?: string;
  readonly date?: LocalDate;
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

export const createEditTransaction =
  (deps: LedgerDeps): EditTransaction =>
  (input) =>
    deps.tm.run(async () => {
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
      const { amount, ...rest } = input.changes;
      if (amount && amount.currency.code !== current.currency) {
        return err(
          domainError("CurrencyMismatch", { expected: current.currency, actual: amount.currency.code }),
        );
      }
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      const now = deps.clock.now();
      const revised = reviseTransaction(current, { ...rest, amount: amount?.minor }, now);
      if (!revised.ok) return revised;
      const changes = changesBetween(current, revised.value);
      if (Object.keys(changes).length === 0) return ok(current);
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
