import type { SpaceMember } from "@/modules/spaces/application";
import { domainError, err, flatMap, ok, type Money, type Result } from "@/shared/kernel";
import type { RecurrenceTemplate } from "../domain/recurrence";
import { splitShares } from "../domain/split";
import { accountInSpace, fundAccount, ownAccount, partyAccount, usableCategory } from "./checks";
import type { LedgerDeps } from "./deps";

/** A template as a definition names it: a contribution's member defaults to the requester (HU-E4-09). */
export type TemplateInput =
  | Exclude<RecurrenceTemplate, { readonly type: "FUND_CONTRIBUTION" }>
  | {
      readonly type: "FUND_CONTRIBUTION";
      readonly fundAccountId: string;
      readonly memberId?: string;
      readonly sourceAccountId: string | null;
    };

export const withContributor = (template: TemplateInput, requesterMemberId: string): RecurrenceTemplate =>
  template.type === "FUND_CONTRIBUTION"
    ? { ...template, memberId: template.memberId ?? requesterMemberId }
    : template;

/** Where a template records, and on whose behalf: the user who defined the recurrence (ruling P21). */
export interface TemplateOwner {
  readonly spaceId: string;
  readonly creatorUserId: string;
}

/**
 * Ruling P21: a template is checked exactly as recording one of its occurrences would check it, for its creator as
 * the requester and with the record use cases' own helpers: a usable category, the fund of this space or a current
 * member's own account (D9: only its owner debits it; any writer may spend the fund or pay for a guest, D15),
 * accounts of this space for incomes and transfers, and a split of current members that holds for `amount`.
 */
export const checkTemplate = async (
  deps: Pick<LedgerDeps, "accounts" | "categories">,
  owner: TemplateOwner,
  members: readonly SpaceMember[],
  template: RecurrenceTemplate,
  amount: Money,
): Promise<Result<RecurrenceTemplate>> => {
  const debit = { required: true, debitedBy: owner.creatorUserId };
  const ownInSpace = async (accountId: string) =>
    flatMap(await ownAccount(deps, accountId, owner.creatorUserId), (account) =>
      accountInSpace(account, owner.spaceId),
    );
  switch (template.type) {
    case "EXPENSE": {
      const category = await usableCategory(deps, owner.spaceId, template.categoryId);
      if (!category.ok) return category;
      const { memberId, accountId } = template.payer;
      if (memberId === null) {
        if (accountId === null) return err(domainError("AccountRequired"));
        const fund = await fundAccount(deps, accountId, owner.spaceId);
        if (!fund.ok) return fund;
      } else {
        const paying = await partyAccount(deps, members, memberId, accountId, debit);
        if (!paying.ok) return paying;
      }
      if (template.split !== null) {
        const shares = splitShares(
          amount,
          template.split,
          members.map((m) => m.id),
        );
        if (!shares.ok) return shares;
      }
      return ok(template);
    }
    case "INCOME": {
      const category = await usableCategory(deps, owner.spaceId, template.categoryId);
      if (!category.ok) return category;
      const account = await ownInSpace(template.accountId);
      return account.ok ? ok(template) : account;
    }
    case "TRANSFER": {
      if (template.sourceAccountId === template.destinationAccountId) {
        return err(domainError("SameAccountTransfer"));
      }
      const source = await ownInSpace(template.sourceAccountId);
      if (!source.ok) return source;
      const destination = await ownInSpace(template.destinationAccountId);
      if (!destination.ok) return destination;
      // Two spellings of one id can resolve to the same account, which recording refuses (the domain's own check).
      return source.value.id === destination.value.id
        ? err(domainError("SameAccountTransfer"))
        : ok(template);
    }
    case "FUND_CONTRIBUTION": {
      const fund = await fundAccount(deps, template.fundAccountId, owner.spaceId);
      if (!fund.ok) return fund;
      const source = await partyAccount(deps, members, template.memberId, template.sourceAccountId, debit);
      return source.ok ? ok(template) : source;
    }
  }
};
