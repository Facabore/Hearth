import type { MemberDto, SpaceDto, TransactionDto } from "@/shared/ui/api/dto";

export interface Viewer {
  readonly userId: string;
  readonly role: SpaceDto["role"];
  /** The viewer's member in a shared or direct space; null in the personal space, whose members are not read. */
  readonly memberId: string | null;
}

export interface TransactionActions {
  readonly edit: boolean;
  readonly delete: boolean;
  readonly note: { readonly key: "GIFT" | "CONTRIBUTION" | "PAID_FOR_FUND" } | null;
}

const NONE: TransactionActions = { edit: false, delete: false, note: null };
const BOTH: TransactionActions = { edit: true, delete: true, note: null };

/**
 * Ruling P344 (amending P190): whoever records money in the space (OWNER, ADMIN, MEMBER: `money.record`, the API's
 * `canCorrect`) edits and deletes any movement, whoever recorded it and whether or not they are a party to it; a VIEWER
 * does neither. The API still refuses what the sheet does not offer: a balance adjustment (design Q4) has no edit
 * screen yet; either half of an expense paid for the fund (D26, P328) or of a gift (P322) keeps the other's parts, so
 * neither is edited and deleting one deletes both; a guest's contribution has no account to stay a transfer with
 * (issue #195), so it is deleted and recorded again.
 */
export const actionsFor = (
  tx: TransactionDto,
  viewer: Viewer,
  members: readonly MemberDto[],
): TransactionActions => {
  if (viewer.role === "VIEWER") return NONE;
  if (tx.type === "ADJUSTMENT") return { edit: false, delete: true, note: null };
  if (tx.linkedTransactionId)
    return { edit: false, delete: true, note: { key: tx.type === "SETTLEMENT" ? "GIFT" : "PAID_FOR_FUND" } };
  const payer = members.find((m) => m.id === tx.payerMemberId);
  if (tx.type === "TRANSFER" && payer !== undefined && payer.userId === null)
    return { edit: false, delete: true, note: { key: "CONTRIBUTION" } };
  return BOTH;
};
