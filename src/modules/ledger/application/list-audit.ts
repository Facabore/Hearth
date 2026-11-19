import { authorizeSpaceAction } from "@/modules/spaces/application";
import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { LedgerDeps } from "./deps";
import type { AuditEntry } from "./ports";

/** P344 (S7): an audit entry with its actor's display name in the space; null when they are no current member. */
export interface AuditItem extends AuditEntry {
  readonly actorName: string | null;
}

export type ListAudit = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<AuditItem[]>>;

/** Audit trail of one transaction, also after it was deleted; P344 (S7): who changed it, by name. */
export const createListAudit =
  (deps: LedgerDeps): ListAudit =>
  async (input) => {
    const membership = await authorizeSpaceAction(deps.access, input.spaceId, input.userId, "space.read");
    if (!membership.ok) return membership;
    const transaction = await deps.transactions.findById(membership.value.spaceId, input.transactionId, true);
    if (!transaction) return err(domainError("TransactionNotFound"));
    const entries = await deps.audit.listFor(transaction.id);
    const names = new Map(
      (await deps.members.listCurrent(membership.value.spaceId)).flatMap((m) =>
        m.userId === null ? [] : [[m.userId, m.displayName] as const],
      ),
    );
    return ok(entries.map((entry) => ({ ...entry, actorName: names.get(entry.actorUserId) ?? null })));
  };
