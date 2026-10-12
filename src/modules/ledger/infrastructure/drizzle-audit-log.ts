import { asc, eq } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid } from "@/shared/kernel";
import type { AuditEntry, AuditLog } from "../application/ports";
import { transactionAudit } from "./ledger.schema";

export class DrizzleAuditLog implements AuditLog {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.tm.executor().insert(transactionAudit).values({
      id: entry.id,
      transactionId: entry.transactionId,
      action: entry.action,
      actorUserId: entry.actorUserId,
      at: entry.at,
      changes: entry.changes,
    });
  }

  async listFor(transactionId: string): Promise<AuditEntry[]> {
    if (!isUuid(transactionId)) return [];
    return this.tm
      .executor()
      .select()
      .from(transactionAudit)
      .where(eq(transactionAudit.transactionId, transactionId))
      .orderBy(asc(transactionAudit.at), asc(transactionAudit.id));
  }
}
