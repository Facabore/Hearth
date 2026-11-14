import type { SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import { linkedHalfOf, type ChangeSet, type Transaction } from "../domain/transaction";
import { ensureCurrentParties } from "./checks";
import type { LedgerDeps } from "./deps";

/**
 * Ruling P322, D26: deleting or restoring one half of a gift, or of an expense paid for the fund, does the same to the
 * other half, in the same database transaction and with its own audit entry (D8). The other half is left alone when it is already deleted (or live);
 * its parties are checked as the first half's were (HU-E1-08, HU-E1-12).
 */
export const followLinkedHalf = async (
  deps: Pick<LedgerDeps, "transactions" | "audit" | "ids" | "members">,
  spaceId: SpaceMembership["spaceId"],
  tx: Transaction,
  step: {
    readonly action: "DELETED" | "RESTORED";
    readonly actorUserId: string;
    readonly at: Date;
    readonly apply: (other: Transaction, now: Date) => Transaction;
    readonly changes: (other: Transaction) => ChangeSet;
  },
): Promise<Result<void>> => {
  const linked = linkedHalfOf(tx);
  if (linked === null) return ok(undefined);
  const other = await deps.transactions.findById(spaceId, linked, true);
  if (other === null || (other.deletedAt !== null) === (step.action === "DELETED")) return ok(undefined);
  const parties = await ensureCurrentParties(deps, spaceId, other);
  if (!parties.ok) return parties;
  if (!(await deps.transactions.save(step.apply(other, step.at), other.version))) {
    return err(domainError("PreconditionFailed"));
  }
  await deps.audit.append({
    id: deps.ids.next<"AuditEntry">(),
    transactionId: other.id,
    action: step.action,
    actorUserId: step.actorUserId,
    at: step.at,
    changes: step.changes(other),
  });
  return ok(undefined);
};
