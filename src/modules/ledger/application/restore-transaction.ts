import { domainError, err, ok, type Result } from "@/shared/kernel";
import { canModify, restorationChanges, restore, type Transaction } from "../domain/transaction";
import { ensureCurrentParties, openPeriod } from "./checks";
import type { LedgerDeps } from "./deps";

export type RestoreTransaction = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<Transaction>>;

/**
 * Ruling P185: the undo of HU-E4-06's soft delete. The same guards as a deletion, because a restore moves the same
 * balances back; a transaction that is not deleted is answered unchanged, so a repeated undo changes nothing.
 */
export const createRestoreTransaction =
  (deps: LedgerDeps): RestoreTransaction =>
  (input) =>
    deps.tm.run(async () => {
      // Issue #89: a restore brings money back, so it takes the space row first, as delete does.
      await deps.spaceLocks.lockForMoneyWrite(input.spaceId);
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const current = await deps.transactions.findById(membership.value.spaceId, input.transactionId, true);
      if (!current) return err(domainError("TransactionNotFound"));
      if (!canModify(membership.value.role, current.createdBy, input.userId)) {
        return err(domainError("InsufficientRole"));
      }
      if (current.deletedAt === null) return ok(current);
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      // HU-E1-08, HU-E1-12: a member who left keeps the zero balance they settled with (Task 4b).
      const parties = await ensureCurrentParties(deps, membership.value.spaceId, current);
      if (!parties.ok) return parties;
      const now = deps.clock.now();
      const restored = restore(current, now);
      if (!(await deps.transactions.save(restored, current.version))) {
        return err(domainError("PreconditionFailed"));
      }
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: current.id,
        action: "RESTORED",
        actorUserId: input.userId,
        at: now,
        changes: restorationChanges(current),
      });
      return ok({ ...restored, version: current.version + 1 });
    });
