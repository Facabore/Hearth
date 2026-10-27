import { domainError, err, map, ok, type Result } from "@/shared/kernel";
import { canModify, deletionChanges, softDelete, type Transaction } from "../domain/transaction";
import { ensureCurrentParties, openPeriod } from "./checks";
import type { LedgerDeps } from "./deps";
import type { RecordExpense, RecordExpenseInput } from "./record-expense";
import type { RecordIncome, RecordIncomeInput } from "./record-income";
import type { RecordTransfer, RecordTransferInput } from "./record-transfer";

type Fields<T> = Omit<T, "spaceId" | "userId">;

/** Issue #195: what the movement becomes, with the fields its own record use case takes. */
export type ConversionTarget =
  | ({ readonly type: "EXPENSE" } & Fields<RecordExpenseInput>)
  | ({ readonly type: "INCOME" } & Fields<RecordIncomeInput>)
  | ({ readonly type: "TRANSFER" } & Fields<RecordTransferInput>);

export interface ConvertTransactionInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly transactionId: string;
  /** If-Match, when sent: the version of the movement being converted. */
  readonly expectedVersion: number | null;
  readonly to: ConversionTarget;
}

export type ConvertTransaction = (input: ConvertTransactionInput) => Promise<Result<Transaction>>;

export interface Recorders {
  readonly recordExpense: RecordExpense;
  readonly recordIncome: RecordIncome;
  readonly recordTransfer: RecordTransfer;
}

/** Issue #195: the audit keys that link a converted movement and what it became, both ways. */
export const CONVERTED_TO = "convertedTo";
export const CONVERTED_FROM = "convertedFrom";

// The record use cases read only their own fields; `type` travels along unread.
const recordOf = async (
  recorders: Recorders,
  owner: { spaceId: string; userId: string },
  to: ConversionTarget,
): Promise<Result<Transaction>> => {
  if (to.type === "EXPENSE") return map(await recorders.recordExpense({ ...to, ...owner }), (r) => r.expense);
  return to.type === "INCOME"
    ? recorders.recordIncome({ ...to, ...owner })
    : recorders.recordTransfer({ ...to, ...owner });
};

/**
 * Issue #195: an expense, income or transfer becomes another of the three in one transaction. The new movement is
 * recorded through its own use case, so every rule of recording it applies (role, accounts, category, the new date's
 * period), and the original is soft-deleted under the rules of a deletion (D8). The audit links both ways.
 */
export const createConvertTransaction =
  (deps: LedgerDeps, recorders: Recorders): ConvertTransaction =>
  (input) =>
    deps.tm.run(async () => {
      // Issue #89: the space row first, before membership or anything the write decides on is read.
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
      // A settlement pays a debt between members; it is never an expense, an income or a transfer (HU-E5-02).
      if (current.type === "SETTLEMENT") return err(domainError("TransactionNotConvertible"));
      if (current.type === input.to.type) return err(domainError("SameTransactionType"));
      const open = await openPeriod(deps, current.spaceId, current.date);
      if (!open.ok) return open;
      // HU-E1-08, HU-E1-12: removing the original must not move the balance of a member who left (Task 4b).
      const parties = await ensureCurrentParties(deps, membership.value.spaceId, current);
      if (!parties.ok) return parties;
      // A nested run joins this transaction, so a refusal below rolls the new movement back too.
      const recorded = await recordOf(recorders, { spaceId: input.spaceId, userId: input.userId }, input.to);
      if (!recorded.ok) return recorded;
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
        changes: { ...deletionChanges(current), [CONVERTED_TO]: { from: null, to: recorded.value.id } },
      });
      await deps.audit.append({
        id: deps.ids.next<"AuditEntry">(),
        transactionId: recorded.value.id,
        action: "UPDATED",
        actorUserId: input.userId,
        at: now,
        changes: { [CONVERTED_FROM]: { from: null, to: current.id } },
      });
      return ok(recorded.value);
    });
