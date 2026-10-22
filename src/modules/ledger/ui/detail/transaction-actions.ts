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
  readonly note:
    | { readonly key: "onlyOwner"; readonly name: string }
    | { readonly key: "SETTLEMENT" | "CONTRIBUTION" }
    | null;
}

const NONE: TransactionActions = { edit: false, delete: false, note: null };

/**
 * Ruling P190: HU-E4-06's `canModify` (OWNER and ADMIN any, MEMBER their own, VIEWER none) for both actions, and D9 for
 * Editar: only whoever's account the money moves through may change it, so the sheet never offers an edit the API
 * refuses. Settlements and fund contributions are deleted and recorded again (P188).
 */
export const actionsFor = (
  tx: TransactionDto,
  viewer: Viewer,
  members: readonly MemberDto[],
): TransactionActions => {
  const { role, userId } = viewer;
  if (!(role === "OWNER" || role === "ADMIN" || (role === "MEMBER" && tx.createdBy === userId))) return NONE;
  if (tx.type === "SETTLEMENT") return { edit: false, delete: true, note: { key: "SETTLEMENT" } };
  if (tx.type === "TRANSFER" && tx.payerMemberId !== null)
    return { edit: false, delete: true, note: { key: "CONTRIBUTION" } };
  const byUser = (id: string) => members.find((m) => m.userId === id);
  const byMember = (id: string | null) => members.find((m) => m.id === id);
  const owner =
    tx.type === "EXPENSE"
      ? byMember(tx.payments[0]?.memberId ?? null)
      : tx.type === "INCOME"
        ? (byMember(tx.receivingMemberId) ?? byUser(tx.createdBy))
        : byUser(tx.createdBy);
  // A guest or the fund paid (no user), or the money is the viewer's: theirs to change.
  if (!owner || owner.userId === null || owner.userId === userId)
    return { edit: true, delete: true, note: null };
  return { edit: false, delete: true, note: { key: "onlyOwner", name: owner.displayName } };
};
