import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, ok, type Money, type Result } from "@/shared/kernel";
import type { Payment } from "../domain/transaction";
import { fundAccount, inSpaceCurrency, partyAccount } from "./checks";
import type { LedgerDeps } from "./deps";

/** One requested payment (spec 5.2). */
export interface PaymentInput {
  /** The paying member, registered or guest; null for a payment from the shared fund (HU-E4-10). */
  readonly memberId: string | null;
  /** The payer's own account, the shared fund when `memberId` is null, or null for a guest. */
  readonly accountId: string | null;
  readonly amount: Money;
}

/**
 * Spec 5.2: memberId is null only for the shared fund; accountId is null only for a guest. A
 * personal account is debited only by its owner (D9); any member who records money may spend the fund.
 */
const paymentOf = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: PaymentInput,
  userId: string,
): Promise<Result<Payment>> => {
  const currency = inSpaceCurrency(space, requested.amount);
  if (!currency.ok) return currency;
  const { memberId, accountId } = requested;
  const amount = requested.amount.minor;
  if (memberId === null) {
    if (accountId === null) return err(domainError("AccountRequired"));
    return map(await fundAccount(deps, accountId, space.spaceId), (fund) => ({
      memberId: null,
      accountId: fund.id,
      amount,
    }));
  }
  const debit = { required: true, debitedBy: userId };
  return map(await partyAccount(deps, members, memberId, accountId, debit), (account) => ({
    memberId,
    accountId: account,
    amount,
  }));
};

/** Spec 5.2, D9: each requested payment resolved; each member pays at most once (fund payments are MixedFundPayment's). */
export const resolvePayments = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: readonly PaymentInput[],
  userId: string,
): Promise<Result<Payment[]>> => {
  const payers = requested.flatMap((payment) => (payment.memberId === null ? [] : [payment.memberId]));
  if (new Set(payers).size !== payers.length)
    return err(domainError("InvalidSplit", { reason: "duplicatePayer" }));
  const payments: Payment[] = [];
  for (const payment of requested) {
    const resolved = await paymentOf(deps, space, members, payment, userId);
    if (!resolved.ok) return resolved;
    payments.push(resolved.value);
  }
  return ok(payments);
};
