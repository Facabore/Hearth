import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { ok, type Money, type Result } from "@/shared/kernel";
import { positiveAmount, recordFundContribution, type Transfer } from "../domain/transaction";
import { authorizeWriter, fundAccount, inSpaceCurrency, openPeriod, partyAccount } from "./checks";
import type { LedgerDeps } from "./deps";
import { whenOf, type WhenInput } from "./when";

export interface RecordFundContributionInput extends Omit<WhenInput, "userId"> {
  readonly spaceId: string;
  readonly userId: string;
  readonly description?: string;
  readonly amount: Money;
  /** The SHARED_FUND account of this space that receives the money. */
  readonly fundAccountId: string;
  /** The contributing member, registered or guest; the requester when absent. */
  readonly memberId?: string;
  /** The contributor's own account; null or absent only for a guest, who contributes outside the app. */
  readonly sourceAccountId?: string | null;
}

export type RecordFundContribution = (input: RecordFundContributionInput) => Promise<Result<Transfer>>;

/** HU-E4-09: who contributes to which fund, and from which account. */
export interface ContributionParties {
  readonly fundAccountId: string;
  readonly contributorMemberId: string;
  readonly sourceAccountId: string | null;
}

/**
 * HU-E4-09, D26: the parties of a contribution to the fund, as recording one checks them: the SHARED_FUND account of
 * this space, the contributor (the requester when absent) and the contributor's own account, which only its owner
 * debits (D9); a guest contributes from outside the app.
 */
export const contributionParties = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  input: {
    readonly userId: string;
    readonly fundAccountId: string;
    readonly memberId?: string;
    readonly sourceAccountId?: string | null;
  },
): Promise<Result<ContributionParties>> => {
  const fund = await fundAccount(deps, input.fundAccountId, space.spaceId);
  if (!fund.ok) return fund;
  const contributor = input.memberId ?? space.memberId;
  // D9: the source is a debit, so only its owner records it.
  const source = await partyAccount(deps, members, contributor, input.sourceAccountId ?? null, {
    required: true,
    debitedBy: input.userId,
  });
  if (!source.ok) return source;
  return ok({
    fundAccountId: fund.value.id,
    contributorMemberId: contributor,
    sourceAccountId: source.value,
  });
};

/**
 * HU-E4-09: a TRANSFER into the shared fund. It belongs to the fund's shared space even when the money
 * leaves a personal account (D9), and it creates no debt between members (D5).
 */
export const createRecordFundContribution =
  (deps: LedgerDeps): RecordFundContribution =>
  (input) =>
    deps.tm.run(async () => {
      const writer = await authorizeWriter(deps, input.spaceId, input.userId);
      if (!writer.ok) return writer;
      const space = writer.value;
      const amount = positiveAmount(input.amount.minor);
      if (!amount.ok) return amount;
      const currency = inSpaceCurrency(space, input.amount);
      if (!currency.ok) return currency;
      const members = await deps.members.listCurrent(space.spaceId);
      const parties = await contributionParties(deps, space, members, input);
      if (!parties.ok) return parties;
      // HU-E4-14: the recorder's zone unless the request names one (ruling P41).
      const when = await whenOf(deps, input);
      if (!when.ok) return when;
      const { date, occurredAt, timeZone } = when.value;
      const open = await openPeriod(deps, space.spaceId, date);
      if (!open.ok) return open;
      const contribution = recordFundContribution({
        id: deps.ids.next<"Transaction">(),
        spaceId: space.spaceId,
        description: input.description,
        date,
        amount: amount.value,
        currency: space.currency,
        createdBy: input.userId,
        occurredAt,
        timeZone,
        now: deps.clock.now(),
        payerMemberId: parties.value.contributorMemberId,
        sourceAccountId: parties.value.sourceAccountId,
        destinationAccountId: parties.value.fundAccountId,
      });
      if (!contribution.ok) return contribution;
      await deps.transactions.add(contribution.value);
      return contribution;
    });
