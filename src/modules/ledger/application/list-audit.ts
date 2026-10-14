import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { LedgerDeps } from "./deps";
import type { AuditEntry } from "./ports";

export type ListAudit = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<AuditEntry[]>>;

/** Audit trail of one transaction, also after it was deleted. */
export const createListAudit =
  (deps: LedgerDeps): ListAudit =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const transaction = await deps.transactions.findById(membership.value.spaceId, input.transactionId, true);
    if (!transaction) return err(domainError("TransactionNotFound"));
    return ok(await deps.audit.listFor(transaction.id));
  };
