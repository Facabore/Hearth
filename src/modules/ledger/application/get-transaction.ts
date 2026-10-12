import { domainError, err, ok, type Result } from "@/shared/kernel";
import type { Transaction } from "../domain/transaction";
import type { LedgerDeps } from "./deps";

export type GetTransaction = (input: {
  spaceId: string;
  userId: string;
  transactionId: string;
}) => Promise<Result<Transaction>>;

export const createGetTransaction =
  (deps: LedgerDeps): GetTransaction =>
  async (input) => {
    const membership = await deps.access(input.spaceId, input.userId);
    if (!membership.ok) return membership;
    const transaction = await deps.transactions.findById(membership.value.spaceId, input.transactionId);
    return transaction ? ok(transaction) : err(domainError("TransactionNotFound"));
  };
