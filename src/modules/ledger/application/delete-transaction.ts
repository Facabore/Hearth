import { domainError, err, ok, type Result } from "@/shared/kernel";
import { canModify, deletionChanges, softDelete } from "../domain/transaction";
import { ensureCurrentParties, openPeriod } from "./checks";
import type { LedgerDeps } from "./deps";

export type DeleteTransaction = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<void>>;

/** HU-E4-06 / D8: soft delete; the row stays for the audit trail and leaves lists, balances and totals. */
export const createDeleteTransaction =
  (deps: LedgerDeps): DeleteTransaction =>
  (input) =>
    deps.tm.run(async () => {
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const current = await deps.transactions.findById(membership.value.spaceId, input.transactionId);
      if (!current) return err(domainError("TransactionNotFound"));
      if (!canModify(membership.value.role, current.createdBy, input.userId)) {
        return err(domainError("InsufficientRole"));
      }
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      // HU-E1-08, HU-E1-12: deleting must not move the balance of a member who left (Task 4b).
      const parties = await ensureCurrentParties(deps, membership.value.spaceId, current);
      if (!parties.ok) return parties;
      const now = deps.clock.now();
      if (!(await deps.transactions.save(softDelete(current, now), current.version))) {
        return err(domainError("PreconditionFailed"));
      }
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: current.id,
        action: "DELETED",
        actorUserId: input.userId,
        at: now,
        changes: deletionChanges(current),
      });
      return ok(undefined);
    });
