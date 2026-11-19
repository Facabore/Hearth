import type { SpaceMember, SpaceMembership } from "@/modules/spaces/application";
import { domainError, err, map, ok, type Money, type Result } from "@/shared/kernel";
import type { Payment } from "../domain/transaction";
import { fundAccount, inCurrency, partyAccount } from "./checks";
import type { LedgerDeps } from "./deps";

/** One requested payment (spec 5.2). */
export interface PaymentInput {
  /** The paying member, registered or guest; null for a payment from the shared fund (HU-E4-10). */
  readonly memberId: string | null;
  /**
   * The payer's own account, the shared fund when `memberId` is null, or null for a guest or (P333) another registered
   * member who paid with their own money.
   */
  readonly accountId: string | null;
  readonly amount: Money;
}

/**
 * Spec 5.2: memberId is null only for the shared fund. A personal account is debited only by its owner (D9); any member
 * who records money may spend the fund. P333 (P168 amended): accountId is null for a guest and for a registered member
 * other than the recorder, who paid with their own money: the expense records only who owes whom and moves none of
 * their accounts. The recorder always names the account they paid from.
 */
const paymentOf = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: PaymentInput,
  userId: string,
  movementCurrency: string,
  kept: readonly Payment[] | undefined,
): Promise<Result<Payment>> => {
  const currency = inCurrency(movementCurrency, requested.amount);
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
  const paidBy = members.find((m) => m.id === memberId);
  // P333, in the spirit of P261 and D26's line payers: a VIEWER only reads the space, so never pays its expenses.
  if (paidBy?.role === "VIEWER") return err(domainError("InvalidSplit", { reason: "viewerPayer" }));
  // P344 (S3): an edit keeps the account a member's payment already has, whoever edits it; the payment stays theirs.
  if (accountId !== null && kept?.some((p) => p.memberId === memberId && p.accountId === accountId)) {
    return ok({ memberId, accountId, amount });
  }
  if (accountId === null && paidBy?.userId != null) {
    // P333: recording leaves another member's payment with no account. P344: an edit also leaves the editor's own
    // with none (S2), and another member's when it is new to the expense or had none (S3); taking an account off
    // another member's payment while they stay its payer is not the editor's to do (AccountNotOwned).
    const own = paidBy.userId === userId;
    const unassigned = { memberId, accountId: null, amount };
    if (kept === undefined) {
      if (!own) return ok(unassigned);
    } else if (own || !kept.find((p) => p.memberId === memberId)?.accountId) {
      return ok(unassigned);
    } else return err(domainError("AccountNotOwned"));
  }
  const debit = { required: true, debitedBy: userId };
  return map(await partyAccount(deps, members, memberId, accountId, debit), (account) => ({
    memberId,
    accountId: account,
    amount,
  }));
};

/**
 * Spec 5.2, D9: each requested payment resolved; each member pays at most once (fund payments are MixedFundPayment's).
 * P342: every payment is in the movement's currency, `currency` (the space's when absent), else CurrencyMismatch.
 * P344: an edit passes the expense's current payments as `kept`; recording passes none.
 */
export const resolvePayments = async (
  deps: Pick<LedgerDeps, "accounts">,
  space: SpaceMembership,
  members: readonly SpaceMember[],
  requested: readonly PaymentInput[],
  userId: string,
  currency: string = space.currency,
  kept?: readonly Payment[],
): Promise<Result<Payment[]>> => {
  const payers = requested.flatMap((payment) => (payment.memberId === null ? [] : [payment.memberId]));
  if (new Set(payers).size !== payers.length)
    return err(domainError("InvalidSplit", { reason: "duplicatePayer" }));
  const payments: Payment[] = [];
  for (const payment of requested) {
    const resolved = await paymentOf(deps, space, members, payment, userId, currency, kept);
    if (!resolved.ok) return resolved;
    payments.push(resolved.value);
  }
  return ok(payments);
};
