import { domainError, err, ok, type Result } from "@/shared/kernel";
import {
  canModify,
  deletionChanges,
  restorationChanges,
  restore,
  softDelete,
  type Transaction,
} from "../domain/transaction";
import { ensureCurrentParties, openPeriod } from "./checks";
import { CONVERTED_FROM, CONVERTED_TO } from "./convert-transaction";
import type { LedgerDeps } from "./deps";

export type UndoConversion = (input: {
  spaceId: string;
  userId: string;
  /** The movement that was converted (the original). */
  transactionId: string;
}) => Promise<Result<Transaction>>;

/**
 * Issue #195: the undo of a conversion, in one transaction. The original comes back as it was (ruling P185) and what it
 * became is soft-deleted, each under the rules of a restore and a deletion; an original that is live is answered
 * unchanged, so a repeated undo changes nothing.
 */
export const createUndoConversion =
  (deps: LedgerDeps): UndoConversion =>
  (input) =>
    deps.tm.run(async () => {
      // Issue #89: both writes move money, so the space row comes first.
      await deps.spaceLocks.lockForMoneyWrite(input.spaceId);
      const membership = await deps.access(input.spaceId, input.userId);
      if (!membership.ok) return membership;
      const spaceId = membership.value.spaceId;
      const original = await deps.transactions.findById(spaceId, input.transactionId, true);
      if (!original) return err(domainError("TransactionNotFound"));
      if (!canModify(membership.value.role, original.createdBy, input.userId)) {
        return err(domainError("InsufficientRole"));
      }
      if (original.deletedAt === null) return ok(original);
      // The latest deletion decides: a movement converted, restored and deleted again is a plain deletion.
      const deletion = (await deps.audit.listFor(original.id)).filter((e) => e.action === "DELETED").at(-1);
      const convertedId = deletion?.changes[CONVERTED_TO]?.to ?? null;
      if (convertedId === null) return err(domainError("TransactionNotConverted"));
      const open = await openPeriod(deps, original.spaceId, original.date);
      if (!open.ok) return open;
      const parties = await ensureCurrentParties(deps, spaceId, original);
      if (!parties.ok) return parties;
      // Deleted on its own since, it stays deleted; only the original comes back.
      const converted = await deps.transactions.findById(spaceId, convertedId);
      if (converted) {
        if (!canModify(membership.value.role, converted.createdBy, input.userId)) {
          return err(domainError("InsufficientRole"));
        }
        const convertedOpen = await openPeriod(deps, converted.spaceId, converted.date);
        if (!convertedOpen.ok) return convertedOpen;
        const convertedParties = await ensureCurrentParties(deps, spaceId, converted);
        if (!convertedParties.ok) return convertedParties;
      }
      const now = deps.clock.now();
      if (converted) {
        if (!(await deps.transactions.save(softDelete(converted, now), converted.version))) {
          return err(domainError("PreconditionFailed"));
        }
        await deps.audit.append({
          id: deps.ids.next<"AuditEntry">(),
          transactionId: converted.id,
          action: "DELETED",
          actorUserId: input.userId,
          at: now,
          changes: { ...deletionChanges(converted), [CONVERTED_FROM]: { from: original.id, to: null } },
        });
      }
      const restored = restore(original, now);
      if (!(await deps.transactions.save(restored, original.version))) {
        return err(domainError("PreconditionFailed"));
      }
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: original.id,
        action: "RESTORED",
        actorUserId: input.userId,
        at: now,
        changes: { ...restorationChanges(original), [CONVERTED_TO]: { from: convertedId, to: null } },
      });
      return ok({ ...restored, version: original.version + 1 });
    });
