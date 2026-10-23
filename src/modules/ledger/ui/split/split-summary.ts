import type { SplitDraft } from "./split-request";

/**
 * U2: the members a split includes, in join order. The plan's split includes those it gives a share to (once the API
 * has answered); every other method, and the plan's before it answers, includes the selected members.
 */
export const includedIds = (
  draft: SplitDraft,
  memberIds: readonly string[],
  allocation: readonly { readonly memberId: string; readonly amount: string }[] | null,
): string[] => {
  if (draft.method === "BY_ALLOCATION" && allocation !== null) {
    const paying = new Set(
      allocation.filter((share) => BigInt(share.amount) > 0n).map((share) => share.memberId),
    );
    return memberIds.filter((id) => paying.has(id));
  }
  return memberIds.filter((id) => draft.selected.includes(id));
};
