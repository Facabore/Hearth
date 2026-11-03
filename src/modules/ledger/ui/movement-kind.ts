import type { TransactionDto } from "@/shared/ui/api/dto";

/**
 * Issue #223 (ruling P283): how a movement is named. A contribution to the shared fund is a TRANSFER that names its
 * contributor (HU-E4-09), so its row and its sheet call it one; every other movement is named by its type.
 */
export const kindOf = (tx: Pick<TransactionDto, "type" | "payerMemberId">) =>
  tx.type === "TRANSFER" && tx.payerMemberId !== null ? ("FUND_CONTRIBUTION" as const) : tx.type;
