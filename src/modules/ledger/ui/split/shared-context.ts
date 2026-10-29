import type { AccountDto, MemberDto } from "@/shared/ui/api/dto";
import type { SplitDraft } from "./split-request";

/** HU-E9-06, ruling P168: what a shared expense's payer and split are chosen from. */
export interface SharedExpenseContext {
  /** Current members in join order: the participants. */
  readonly members: readonly MemberDto[];
  readonly meMemberId: string;
  /** Active accounts the recorder owns: their personal space's, then their own in this space (D9). */
  readonly myAccounts: readonly AccountDto[];
  /** The space's active shared funds, which pay with no payer member (HU-E4-10). */
  readonly funds: readonly AccountDto[];
}

const active = (account: AccountDto) => account.archivedAt === null;

export const sharedContextOf = (input: {
  readonly meUserId: string;
  readonly members: readonly MemberDto[];
  readonly spaceAccounts: readonly AccountDto[];
  readonly personalAccounts: readonly AccountDto[];
}): SharedExpenseContext | null => {
  const me = input.members.find((member) => member.userId === input.meUserId);
  if (!me) return null;
  return {
    members: input.members,
    meMemberId: me.id,
    myAccounts: [
      ...input.personalAccounts.filter(active),
      ...input.spaceAccounts.filter(
        (a) => active(a) && a.type !== "SHARED_FUND" && a.ownerUserId === input.meUserId,
      ),
    ],
    funds: input.spaceAccounts.filter((a) => active(a) && a.type === "SHARED_FUND"),
  };
};

/**
 * The recorder pays from `payerAccountId` (the record form passes the one paid from last, issue #208), else their
 * first account, equally among every current member, until a default or a choice.
 */
export const initialSplitDraft = (
  context: SharedExpenseContext,
  payerAccountId: string | null = context.myAccounts[0]?.id ?? null,
): SplitDraft => ({
  payer: { kind: "ME", memberId: context.meMemberId, accountId: payerAccountId },
  method: "EQUAL",
  selected: context.members.map((member) => member.id),
  values: {},
  chosen: false,
});
